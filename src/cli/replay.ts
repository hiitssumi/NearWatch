// Replay command: `npm run replay -- [recording] [--verify]`.
// Runs the Audit from a Recording and prints the transcript. With --verify, every Scenario is re-run in the
// real sandbox and every proof re-checked with the real Lean, and each result must match the Recording.
import { parseArgs } from "node:util";
import { auditOptionsFrom, runAudit } from "../audit.ts";
import { readContract } from "../contract.ts";
import { findLean } from "../lean.ts";
import { localToolchain } from "../live-audit.ts";
import { loadRecording, replayPorts } from "../replay/recording.ts";
import { VerificationError, VerifyingToolchain } from "../replay/verify.ts";
import { findCargo } from "../sandbox.ts";

/** The demo Recording: one full live Audit of the buggy vault, paid on NEAR testnet (ticket 11). */
const DEFAULT_RECORDING = new URL("../../recordings/demo-buggy-vault.json", import.meta.url).pathname;

const { positionals, values } = parseArgs({ allowPositionals: true, options: { verify: { type: "boolean" } } });
const path = positionals[0] ?? DEFAULT_RECORDING;

try {
  const recording = await loadRecording(path);
  console.log(`Replaying ${path} (commit ${recording.commit})`);
  if (recording.fee) console.log("This Audit paid on NEAR testnet. Replay prints the recorded transaction hashes and sends nothing.");

  const ports = replayPorts(recording);
  let verifying: VerifyingToolchain | null = null;
  if (values.verify) {
    const missing = [
      ...(findCargo() ? [] : ["Rust is not installed. Install rustup (https://rustup.rs) and the wasm target; the steps are in rust/README.md."]),
      ...(findLean() ? [] : ["Lean is not installed. Install elan (https://github.com/leanprover/elan) and run `elan default stable`, or set NEARWATCH_LEAN."]),
    ];
    if (missing.length > 0) throw new Error(`replay with verification needs Rust and Lean.\n  ${missing.join("\n  ")}`);
    // The sandbox builds the contract at the recorded path, so that must still be the source the Audit read.
    const source = await readContract(recording.contract.path);
    if (source !== recording.contract.source) {
      throw new VerificationError(`The contract at ${recording.contract.path} is not the source this Recording audited, so its Scenarios cannot be verified against it.`);
    }
    console.log("Verifying: every Scenario is re-run in the sandbox and every proof re-checked with Lean. The LLM answers come from the Recording.");
    verifying = new VerifyingToolchain(recording.toolchain, localToolchain(), (line) => console.log(line));
    ports.toolchain = verifying;
  }
  console.log("");

  const replay = () => runAudit(recording.contract.path, ports, auditOptionsFrom(recording.settings));
  const result = verifying ? await verifying.run(replay) : await replay();
  if (verifying) console.log("");
  console.log(result.transcript.join("\n"));
  if (verifying) {
    const { scenarios, lean } = verifying.verified;
    console.log(`\nVERIFIED: ${scenarios} Scenario runs and ${lean} Lean checks were re-run for real, and every one matches the Recording.`);
  }
} catch (e) {
  const failed = e instanceof VerificationError ? "VERIFICATION FAILED" : "replay failed";
  console.error(`${failed}: ${(e as Error).message}`);
  process.exitCode = 1;
}
