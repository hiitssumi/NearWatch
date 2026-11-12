// Slow: Scenarios run by the real sandbox harness (rust/harness) against the demo vaults.
// Needs Rust, the wasm32 target and cargo-near (rust/README.md). Skips when cargo is missing.
// The first run compiles the harness and both vaults; later runs take about 6 seconds a Scenario.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Rule, Scenario } from "../src/domain.ts";
import { loadRecording } from "../src/replay/recording.ts";
import { referee } from "../src/referee.ts";
import { HAND_MADE, handMadeRules, handMadeScenario } from "./hand-made.ts";
import { buildCounts, findCargo, LocalSandbox, SandboxError } from "../src/sandbox.ts";

const skip = findCargo() ? false : "cargo is not installed (see rust/README.md)";
const BUGGY = new URL("../rust/vaults/buggy", import.meta.url).pathname;
const FIXED = new URL("../rust/vaults/fixed", import.meta.url).pathname;

/** The hand-written Scenario (deposit, then withdraw to an account that does not exist) and Rule 1. */
async function handWritten(): Promise<{ scenario: Scenario; rule1: Rule }> {
  const r = await loadRecording(HAND_MADE);
  return { scenario: handMadeScenario(r), rule1: handMadeRules(r).find((x) => x.id === "R1")! };
}

const sandbox = new LocalSandbox();

test("the hand-written Scenario makes Rule 1's Rule check true on the buggy vault", { skip }, async () => {
  const { scenario, rule1 } = await handWritten();
  const outcome = await sandbox.runScenario(BUGGY, scenario, rule1.check);
  assert.equal(outcome.ruleCheckTrue, true);
  const { before, after, failedReceipts } = outcome.observations;
  assert.equal(before.views.user_recorded, "0");
  assert.equal(after.views.user_recorded, "0", "the recorded balance stays reduced");
  assert.equal(after.balances.receiver_wallet, "0", "the receiver does not exist");
  assert.ok(failedReceipts.some((f) => f.includes("nobody-here") && f.includes("doesn't exist")), failedReceipts.join("\n"));
});

test("the same Scenario leaves Rule 1's Rule check false on the fixed vault", { skip }, async () => {
  const { scenario, rule1 } = await handWritten();
  const outcome = await sandbox.runScenario(FIXED, scenario, rule1.check);
  assert.equal(outcome.ruleCheckTrue, false);
  assert.equal(outcome.observations.after.views.user_recorded, "1000000000000000000000000", "the callback restored it");
  assert.equal(outcome.observations.failedReceipts.length, 1);
});

test("a second Scenario does not recompile the harness or the contract", { skip }, async () => {
  const { scenario, rule1 } = await handWritten();
  const before = { ...buildCounts };
  await sandbox.runScenario(BUGGY, scenario, rule1.check);
  assert.deepEqual(buildCounts, before);
  assert.equal(buildCounts.harness, 1);
  assert.equal(buildCounts.contracts, 2, "one build per vault crate");
});

test("an unknown action is reported as an error that names it, and the Referee keeps the Scenario as a Lead", { skip }, async () => {
  const { scenario, rule1 } = await handWritten();
  const bad = { ...scenario, actions: [...scenario.actions, { action: "deploy", code: "x" }] } as unknown as Scenario;
  await assert.rejects(sandbox.runScenario(BUGGY, bad, rule1.check), (e: unknown) => {
    assert.ok(e instanceof SandboxError);
    assert.equal(e.kind, "invalid");
    assert.match(e.message, /scenario\.actions\[3\]\.action: unknown variant `deploy`/);
    return true;
  });

  const lines: string[] = [];
  const toolchain = { runScenario: sandbox.runScenario.bind(sandbox), checkLean: () => Promise.reject(new Error("unused")) };
  const result = await referee(BUGGY, [rule1], [bad], toolchain, (l) => lines.push(l));
  assert.equal(result.findings.length, 0);
  assert.match(result.leads[0]!.reason, /could not be run: .*deploy/);
  assert.deepEqual(result.verdicts, { R1: "Unproven" });
});

test("a malformed amount is reported with its path", { skip }, async () => {
  const { scenario, rule1 } = await handWritten();
  const bad = structuredClone(scenario);
  (bad.actions[1] as { deposit: string }).deposit = "1 NEAR";
  await assert.rejects(sandbox.runScenario(BUGGY, bad, rule1.check), /scenario\.actions\[1\]\.deposit is "1 NEAR"/);
});
