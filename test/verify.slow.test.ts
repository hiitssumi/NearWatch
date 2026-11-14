// Slow: replay with verification against the real sandbox and the real Lean (ticket 15). Skips when Rust or
// Lean is missing. The first run builds the harness and the vault, which takes a few minutes.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { findLean } from "../src/lean.ts";
import { findCargo } from "../src/sandbox.ts";

const skip = !findCargo() ? "cargo is not installed (see rust/README.md)" : !findLean() ? "Lean is not installed (see test/lean.slow.test.ts)" : false;
const ROOT = new URL("..", import.meta.url).pathname;
const DEMO = join(ROOT, "recordings", "demo-buggy-vault.json");
const run = promisify(execFile);

/** Runs `npm run replay -- --verify <recording>` from the repository root, as the README says to. */
async function verify(recording: string): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await run(process.execPath, ["src/cli/replay.ts", recording, "--verify"], { cwd: ROOT, maxBuffer: 16 * 1024 * 1024 });
    return { code: 0, stdout, stderr };
  } catch (e) {
    const failed = e as { code: number; stdout: string; stderr: string };
    return { code: failed.code, stdout: failed.stdout, stderr: failed.stderr };
  }
}

/** A copy of the demo Recording with one change. */
async function altered(change: (recording: { toolchain: { op: string; outcome?: Record<string, unknown> }[] }) => void): Promise<string> {
  const recording = JSON.parse(await readFile(DEMO, "utf8"));
  change(recording);
  const path = join(await mkdtemp(join(tmpdir(), "nearwatch-altered-")), "recording.json");
  await writeFile(path, JSON.stringify(recording));
  return path;
}

test("real toolchain: replay --verify passes on the shipped demo Recording, re-running every Scenario and every proof", { skip }, async () => {
  const { code, stdout, stderr } = await verify(DEMO);
  assert.equal(code, 0, stderr);
  assert.match(stdout, /re-ran Scenario S4 \(run #4 of 26\) in the sandbox: matches the Recording/);
  assert.match(stdout, /VERIFIED: 26 Scenario runs and 19 Lean checks were re-run for real, and every one matches the Recording\./);
  assert.ok(stdout.includes("== CONFLICT on R2 =="), "the transcript is printed too");
});

test("real toolchain: replay --verify fails, naming the Scenario, when a recorded sandbox outcome has been altered", { skip }, async () => {
  // The Recording now claims the Attacker's first Scenario broke its Rule. The real sandbox says it did not.
  const path = await altered((r) => {
    const first = r.toolchain.find((e) => e.op === "runScenario")!;
    first.outcome!.ruleCheckTrue = true;
  });
  const { code, stdout, stderr } = await verify(path);
  assert.equal(code, 1);
  assert.match(stderr, /^VERIFICATION FAILED: Scenario S1 \(run #1 of 26\) does not match the Recording when re-run in the sandbox\. outcome\.ruleCheckTrue: recorded true, re-run false/);
  assert.ok(!stdout.includes("VERIFIED"));
});

test("real toolchain: replay --verify fails, naming the proof, when a recorded Lean outcome has been altered", { skip }, async () => {
  // The Recording now claims Lean rejected the first file it checked. The real Lean accepts it.
  const path = await altered((r) => {
    const first = r.toolchain.find((e) => e.op === "checkLean")!;
    first.outcome = { ...first.outcome, ok: false, errors: "property_R1.lean:1:1: error: made up" };
  });
  const { code, stdout, stderr } = await verify(path);
  assert.equal(code, 1);
  assert.match(stderr, /^VERIFICATION FAILED: the Lean check of R1 \(check #1 of 19\) does not match the Recording when re-checked with Lean\. errors: recorded "property_R1\.lean:1:1: error: made up", re-run ""/);
  assert.ok(!stdout.includes("VERIFIED"));
});
