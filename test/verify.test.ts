// Ticket 15: replay with verification, with a stand-in for the real toolchain. The real one is in
// test/verify.slow.test.ts.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { auditOptionsFrom, runAudit } from "../src/audit.ts";
import type { Toolchain } from "../src/ports.ts";
import { loadRecording, type Recording, ReplayToolchain, replayPorts } from "../src/replay/recording.ts";
import { firstDifference, VerificationError, VerifyingToolchain } from "../src/replay/verify.ts";

const DEMO = new URL("../recordings/demo-buggy-vault.json", import.meta.url).pathname;

/** Replays `recording` with every toolchain outcome "re-run" by `real` and compared with the Recording. */
async function verify(recording: Recording, real: Toolchain) {
  const lines: string[] = [];
  const toolchain = new VerifyingToolchain(recording.toolchain, real, (l) => lines.push(l));
  const result = await toolchain.run(() => runAudit(recording.contract.path, { ...replayPorts(recording), toolchain }, auditOptionsFrom(recording.settings)));
  return { result, toolchain, lines };
}

/** A "real" toolchain that gives back what `source` recorded, as an honest re-run would. */
const rerunFrom = (source: Recording): Toolchain => new ReplayToolchain(structuredClone(source.toolchain));

test("when every re-run matches, the replay is the Recording's own, and each check is counted and reported", async () => {
  const r = await loadRecording(DEMO);
  // The re-run Lean checks took a different time; that is not part of what Lean said.
  const real = structuredClone(r);
  for (const e of real.toolchain) if (e.op === "checkLean") e.outcome.ms = 1;
  const { result, toolchain, lines } = await verify(r, rerunFrom(real));
  assert.deepEqual(toolchain.verified, { scenarios: 26, lean: 19 });
  assert.equal(lines.length, 45);
  assert.ok(lines.includes("  re-ran Scenario S4 (run #4 of 26) in the sandbox: matches the Recording"));
  assert.ok(lines.includes("  re-checked Lean check of R2 (check #7 of 19): matches the Recording"));
  const plain = await runAudit(r.contract.path, replayPorts(r), auditOptionsFrom(r.settings));
  assert.deepEqual(result.transcript, plain.transcript);
});

test("a Scenario whose re-run differs from the Recording fails the replay, naming the Scenario and the difference", async () => {
  const r = await loadRecording(DEMO);
  // The Recording claims S4 left alice's ledger at 0; the "real" sandbox restores it (as the fixed vault would).
  const real = structuredClone(r);
  const s4 = real.toolchain.filter((e) => e.op === "runScenario")[3]!;
  assert.ok(s4.op === "runScenario" && "outcome" in s4 && s4.scenario === "S4");
  s4.outcome.observations.after.views.caller_ledger = "1000000000000000000000000";
  s4.outcome.ruleCheckTrue = false;
  await assert.rejects(
    verify(r, rerunFrom(real)),
    (e: Error) =>
      e instanceof VerificationError &&
      e.message ===
        'Scenario S4 (run #4 of 26) does not match the Recording when re-run in the sandbox. outcome.observations.after.views.caller_ledger: recorded "0", re-run "1000000000000000000000000"',
  );
  // A Scenario the Recording says could not be run, which now runs, is a difference too.
  const failing = structuredClone(r);
  const first = failing.toolchain.findIndex((e) => e.op === "runScenario");
  failing.toolchain[first] = { op: "runScenario", scenario: "S1", error: "the sandbox refused it" };
  await assert.rejects(verify(failing, rerunFrom(r)), (e: Error) => e instanceof VerificationError && /^Scenario S1 \(run #1 of 26\) does not match .* error: recorded "the sandbox refused it", re-run nothing$/.test(e.message));
});

test("a proof whose re-check differs from the Recording fails the replay, naming the proof", async () => {
  const r = await loadRecording(DEMO);
  // The Recording says Lean accepted this proof of R2; the "real" Lean does not.
  const real = structuredClone(r);
  const accepted = real.toolchain.filter((e) => e.op === "checkLean").findIndex((e) => e.op === "checkLean" && e.property === "R2" && e.outcome.ok && !e.outcome.axioms.includes("sorryAx"));
  const entry = real.toolchain.filter((e) => e.op === "checkLean")[accepted]!;
  assert.ok(entry.op === "checkLean");
  entry.outcome = { ok: false, errors: "property_R2.lean:70:2: error: unsolved goals", axioms: [] };
  await assert.rejects(
    verify(r, rerunFrom(real)),
    (e: Error) =>
      e instanceof VerificationError &&
      e.message.startsWith(`the Lean check of R2 (check #${accepted + 1} of 19) does not match the Recording when re-checked with Lean. axioms[0]: recorded "propext", re-run nothing`),
  );
  // A changed axiom list alone is caught: a proof that leans on an extra axiom is not the recorded proof.
  const extra = structuredClone(r);
  const e2 = extra.toolchain.filter((e) => e.op === "checkLean")[accepted]!;
  assert.ok(e2.op === "checkLean");
  e2.outcome.axioms = [...e2.outcome.axioms, "cheat"];
  await assert.rejects(verify(r, rerunFrom(extra)), /the Lean check of R2 .* axioms\[2\]: recorded nothing, re-run "cheat"/);
});

test("a Recording holding outcomes the Audit never asks for is not passed as verified", async () => {
  const r = await loadRecording(DEMO);
  const padded = structuredClone(r);
  padded.toolchain.push({ op: "checkLean", property: "R9", outcome: { ok: true, errors: "", axioms: [] } });
  await assert.rejects(verify(padded, rerunFrom(r)), (e: Error) => e instanceof VerificationError && /holds 1 toolchain outcome\(s\) that this replay never asked for/.test(e.message));
});

test("firstDifference names the first place two values differ", () => {
  assert.equal(firstDifference({ a: [1, { b: "x" }] }, { a: [1, { b: "x" }] }), null);
  assert.equal(firstDifference({ a: [1, { b: "x" }] }, { a: [1, { b: "y" }] }), 'a[1].b: recorded "x", re-run "y"');
  assert.equal(firstDifference({ a: 1 }, { a: 1, c: true }), "c: recorded nothing, re-run true");
  assert.equal(firstDifference([1, 2], [1]), "[1]: recorded 2, re-run nothing");
  assert.equal(firstDifference("1", 1), 'value: recorded "1", re-run 1');
});

test("without Rust and Lean, replay --verify says which is missing and how to install it; plain replay still works", () => {
  // A machine with only Node: an empty home folder and a PATH that holds nothing but node.
  const home = mkdtempSync(join(tmpdir(), "nearwatch-bare-"));
  const env = { HOME: home, PATH: dirname(process.execPath) };
  const cli = new URL("../src/cli/replay.ts", import.meta.url).pathname;
  let stderr = "";
  try {
    execFileSync(process.execPath, [cli, "--verify"], { env, encoding: "utf8", stdio: "pipe" });
    assert.fail("replay --verify should have failed");
  } catch (e) {
    stderr = (e as { stderr: string }).stderr;
    assert.equal((e as { status: number }).status, 1);
  }
  assert.match(stderr, /replay failed: replay with verification needs Rust and Lean\./);
  assert.match(stderr, /Rust is not installed\. Install rustup \(https:\/\/rustup\.rs\) and the wasm target; the steps are in rust\/README\.md\./);
  assert.match(stderr, /Lean is not installed\. Install elan \(https:\/\/github\.com\/leanprover\/elan\) and run `elan default stable`/);
  const plain = execFileSync(process.execPath, [cli], { env, encoding: "utf8" });
  assert.ok(plain.includes("== CONFLICT on R2 =="));
  assert.ok(!plain.includes("VERIFIED"));
});
