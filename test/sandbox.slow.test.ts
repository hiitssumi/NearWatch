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

/** The hand-written Scenario (setup: deposit; call: withdraw to an account that does not exist) and the Rules. */
async function handWritten(): Promise<{ scenario: Scenario; rule1: Rule; rule2: Rule }> {
  const r = await loadRecording(HAND_MADE);
  const rules = handMadeRules(r);
  return { scenario: handMadeScenario(r), rule1: rules.find((x) => x.id === "R1")!, rule2: rules.find((x) => x.id === "R2")! };
}

const sandbox = new LocalSandbox();
const NEAR = 10n ** 24n;

test("the hand-written Scenario makes Rule 1's Rule check true on the buggy vault", { skip }, async () => {
  const { scenario, rule1 } = await handWritten();
  const outcome = await sandbox.runScenario(BUGGY, scenario, rule1.check);
  assert.equal(outcome.ruleCheckTrue, true);
  const { before, after, failedReceipts } = outcome.observations;
  assert.equal(before.views.user_recorded, NEAR.toString(), "before is observed after the setup's deposit");
  assert.equal(after.views.user_recorded, "0", "the recorded balance stays reduced");
  assert.equal(after.balances.receiver_wallet, "0", "the receiver does not exist");
  assert.ok(failedReceipts.some((f) => f.includes("nobody-here") && f.includes("doesn't exist")), failedReceipts.join("\n"));
  // The stored outcomes in the hand-made Recording are this run's.
  const stored = (await loadRecording(HAND_MADE)).toolchain[0]!;
  assert.deepEqual("outcome" in stored && stored.outcome, outcome);
});

test("the same Scenario leaves Rule 1's Rule check false on the fixed vault", { skip }, async () => {
  const { scenario, rule1 } = await handWritten();
  const outcome = await sandbox.runScenario(FIXED, scenario, rule1.check);
  assert.equal(outcome.ruleCheckTrue, false);
  assert.equal(outcome.observations.after.views.user_recorded, NEAR.toString(), "the callback restored it");
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

test("the Rule check's bindings are resolved against the call under test, not chosen by the Scenario", { skip }, async () => {
  const { scenario, rule1 } = await handWritten();
  // Withdraw to bob, who exists: $arg:receiver_id reads bob's wallet, so the debit is matched and the Rule holds.
  const toBob = structuredClone(scenario);
  toBob.setup.push({ action: "createAccount", account: "bob", balance: NEAR.toString() });
  toBob.call.args = { amount: NEAR.toString(), receiver_id: "bob" };
  const outcome = await sandbox.runScenario(BUGGY, toBob, rule1.check);
  assert.equal(outcome.ruleCheckTrue, false);
  assert.equal(BigInt(outcome.observations.after.balances.receiver_wallet!) - BigInt(outcome.observations.before.balances.receiver_wallet!), NEAR);

  const noArg = structuredClone(scenario);
  noArg.call.args = { amount: NEAR.toString() };
  await assert.rejects(sandbox.runScenario(BUGGY, noArg, rule1.check), /reads "\$arg:receiver_id", but the call withdraw\(.*\) has no argument receiver_id/);

  const otherMethod = structuredClone(scenario);
  otherMethod.call = { as: "alice", method: "deposit", args: {}, deposit: NEAR.toString(), gas: "30000000000000" };
  await assert.rejects(sandbox.runScenario(BUGGY, otherMethod, rule1.check), /call\.method is "deposit", but this Rule is about withdraw/);
});

test("a fixed account name in a binding reads the account the setup created; the owner's pause leaves it alone", { skip }, async () => {
  const { rule2 } = await handWritten();
  const scenario: Scenario = {
    id: "pause",
    rule: "R2",
    bugClass: "a privileged method with no access check",
    setup: [
      { action: "createAccount", account: "user", balance: (5n * NEAR).toString() },
      { action: "call", as: "user", method: "deposit", args: {}, deposit: (2n * NEAR).toString(), gas: "30000000000000" },
    ],
    call: { as: "owner", method: "set_deposits_paused", args: { paused: true }, deposit: "0", gas: "30000000000000" },
  };
  const outcome = await sandbox.runScenario(BUGGY, scenario, rule2.check);
  assert.equal(outcome.observations.before.views.user_recorded, (2n * NEAR).toString());
  assert.equal(outcome.ruleCheckTrue, false);
});

test("gas refunds have landed before 'after' is observed", { skip }, async () => {
  const { scenario, rule1 } = await handWritten();
  // Withdraw to oneself with 300 Tgas attached: the receiver gains the amount less a little gas.
  const toSelf = structuredClone(scenario);
  toSelf.call = { ...toSelf.call, args: { amount: NEAR.toString(), receiver_id: "alice" }, gas: "300000000000000" };
  const o = (await sandbox.runScenario(BUGGY, toSelf, rule1.check)).observations;
  const gained = BigInt(o.after.balances.receiver_wallet!) - BigInt(o.before.balances.receiver_wallet!);
  assert.ok(gained > NEAR - 10n ** 22n, `1 NEAR less under 0.01 NEAR of gas, not less the whole 300 Tgas: ${gained}`);
});

test("an unknown action is reported as an error that names it, and the Referee keeps the Scenario as a Lead", { skip }, async () => {
  const { scenario, rule1 } = await handWritten();
  const bad = { ...scenario, setup: [...scenario.setup, { action: "deploy", code: "x" }] } as unknown as Scenario;
  await assert.rejects(sandbox.runScenario(BUGGY, bad, rule1.check), (e: unknown) => {
    assert.ok(e instanceof SandboxError);
    assert.equal(e.kind, "invalid");
    assert.match(e.message, /scenario\.setup\[2\]\.action: unknown variant `deploy`/);
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
  (bad.setup[1] as { deposit: string }).deposit = "1 NEAR";
  await assert.rejects(sandbox.runScenario(BUGGY, bad, rule1.check), /scenario\.setup\[1\]\.deposit is "1 NEAR"/);
});
