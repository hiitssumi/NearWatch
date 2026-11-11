# NearWatch Rust workspace

- `vaults/buggy` — the demo vault with the planted bug (withdraw lowers the balance, sends an async transfer, never restores it on failure).
- `vaults/fixed` — the same vault with a callback that restores the balance when the transfer fails.
- `vaults/tests` — near-workspaces 0.24 sandbox tests for both vaults (spec, "Seam 2").
- `harness` — the fixed sandbox harness (`nearwatch-harness`) that runs one Scenario and evaluates its Rule check. `src/sandbox.ts` drives it.

## Install (macOS / Linux)

```bash
# Rust via rustup (https://rustup.rs), plus the wasm target
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
rustup target add wasm32-unknown-unknown

# cargo-near (prebuilt binary from the official installer), used to build the contracts
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/near/cargo-near/releases/download/cargo-near-v0.23.0/cargo-near-installer.sh | sh
```

Tested with Rust 1.99.1, cargo-near 0.23.0, near-sdk 5.30, near-workspaces 0.24.0.
The NEAR sandbox binary is downloaded automatically by near-workspaces on the first test build.

## Build and test

```bash
cd rust
cargo test                                            # builds both vaults to wasm and runs all sandbox tests
(cd vaults/buggy && cargo near build non-reproducible-wasm)   # -> target/near/vault_buggy/vault_buggy.wasm
(cd vaults/fixed && cargo near build non-reproducible-wasm)   # -> target/near/vault_fixed/vault_fixed.wasm
```

Plain `cargo build`/`cargo test -p vault-buggy` fails on purpose: near-sdk only builds contracts for wasm.
`cargo test` at the workspace root runs the default members (`vaults/tests`, `harness`).

## The sandbox harness

```bash
cargo build --release -p nearwatch-harness
./target/release/nearwatch-harness < request.json
```

The request is one JSON object: `{ "wasm": "<path>.wasm", "setup"?: {...}, "scenario": Scenario, "check": RuleCheck }`
(Scenario and RuleCheck as in `src/domain.ts`). It prints one line:
`{"ok":true,"outcome":{"observations":...,"ruleCheckTrue":...}}`, or `{"ok":false,"kind":"invalid"|"internal","error":"..."}`.
Exit code 0 on success, 2 for an invalid request, 1 for an internal failure.

- Every run starts a fresh local sandbox. The harness creates only `near_workspaces::sandbox()`. It has no testnet or mainnet worker and takes no RPC address.
- Setup (default): `owner` gets 100 NEAR, the contract is deployed to `vault`, and `owner` calls `new({"owner":"owner"})`.
- Account names in a Scenario are top-level sandbox accounts (`alice`, `nobody-here`), created through the sandbox's `registrar`. Only accounts that setup or the Scenario created can sign calls. A call "as" anyone else is recorded as not sent.
- `before` is observed after the Scenario's opening `createAccount` actions, and `after` once every action has run. A missing account's balance is `"0"`.
- `failedReceipts` holds one line per failed receipt, per call never sent, and per failed view action or `createAccount`.
- On macOS the sandbox binary links Homebrew's `liblzma`. The harness sets `DYLD_FALLBACK_LIBRARY_PATH=/usr/local/lib:/usr/lib` so it finds the system copy, so no `brew install xz` is needed.
