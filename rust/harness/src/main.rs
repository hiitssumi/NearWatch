//! NearWatch sandbox harness.
//!
//! Reads one JSON request on stdin: `{ "wasm", "setup"?, "scenario", "check" }` (see `request.rs`),
//! runs the Scenario in a fresh local sandbox, evaluates the Rule check, and prints one JSON line:
//! `{ "ok": true, "outcome": { "observations", "ruleCheckTrue" } }` or
//! `{ "ok": false, "kind": "invalid" | "internal", "error": "..." }`.
//! Exit code: 0 ok, 2 invalid request, 1 internal failure.

mod check;
mod request;
mod run;

use std::io::Read;

use request::{ErrorKind, HarnessError, Request, Response};

fn parse(input: &str) -> Result<Request, HarnessError> {
    let de = &mut serde_json::Deserializer::from_str(input);
    serde_path_to_error::deserialize(de).map_err(|e| {
        let path = e.path().to_string();
        let inner = e.into_inner();
        if path == "." {
            HarnessError::invalid(format!("malformed request: {inner}"))
        } else {
            HarnessError::invalid(format!("malformed request at {path}: {inner}"))
        }
    })
}

fn main() {
    // The sandbox binary for macOS links Homebrew's liblzma by absolute path. macOS ships the same
    // library in /usr/lib, which dyld only searches when this variable is set. `cargo run` and
    // `cargo test` set it; a bare process does not. Set before any thread or child process starts.
    #[cfg(target_os = "macos")]
    if std::env::var_os("DYLD_FALLBACK_LIBRARY_PATH").is_none() {
        std::env::set_var("DYLD_FALLBACK_LIBRARY_PATH", "/usr/local/lib:/usr/lib");
    }
    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime starts");
    runtime.block_on(run_once());
}

async fn run_once() {
    let mut input = String::new();
    let result = match std::io::stdin().read_to_string(&mut input) {
        Ok(_) => match parse(&input) {
            Ok(req) => run::run(req).await,
            Err(e) => Err(e),
        },
        Err(e) => Err(HarnessError::internal(format!("could not read stdin: {e}"))),
    };
    let (response, code) = match result {
        Ok(outcome) => (Response::Ok { ok: true, outcome }, 0),
        Err(e) => {
            let code = if e.kind == ErrorKind::Invalid { 2 } else { 1 };
            (Response::Err { ok: false, kind: e.kind, error: e.message }, code)
        }
    };
    println!("{}", serde_json::to_string(&response).expect("response serialises"));
    std::process::exit(code);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(actions: &str) -> String {
        format!(
            r#"{{"wasm":"x.wasm","scenario":{{"id":"S","rule":"R1","bugClass":"b","actions":{actions},"bind":{{}}}},
               "check":{{"slots":[],"condition":{{"compare":"==","left":{{"number":"1"}},"right":{{"number":"1"}}}}}}}}"#
        )
    }

    #[test]
    fn unknown_action_is_named() {
        let e = parse(&req(r#"[{"action":"selfdestruct","as":"alice"}]"#)).unwrap_err();
        assert_eq!(e.kind, ErrorKind::Invalid);
        assert!(e.message.contains("scenario.actions[0]"), "{}", e.message);
        assert!(e.message.contains("selfdestruct"), "{}", e.message);
    }

    #[test]
    fn missing_field_is_named() {
        let e = parse(&req(r#"[{"action":"call","as":"alice","method":"deposit","args":{},"gas":"1"}]"#)).unwrap_err();
        assert!(e.message.contains("deposit"), "{}", e.message);
    }

    #[test]
    fn not_json_is_reported() {
        let e = parse("{ nope").unwrap_err();
        assert!(e.message.starts_with("malformed request"), "{}", e.message);
    }

    #[test]
    fn harness_source_never_names_another_network() {
        for src in [include_str!("run.rs"), include_str!("main.rs"), include_str!("check.rs")] {
            for banned in ["testnet(", "mainnet(", "custom(", "betanet("] {
                let needle = format!("near_workspaces::{banned}");
                assert!(!src.contains(&needle), "harness must only use the local sandbox");
            }
        }
    }
}
