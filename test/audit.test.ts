// Seam 1: the Audit, run from a Recording. Needs only Node.
import assert from "node:assert/strict";
import { test } from "node:test";
import { runAudit } from "../src/audit.ts";
import { FakePayer, loadRecording, type Recording, replayPorts } from "../src/replay/recording.ts";
import { HAND_MADE, storedOutcome } from "./hand-made.ts";

const audit = (r: Recording) => runAudit(r.contract.path, replayPorts(r, new FakePayer()));

test("the hand-made Recording ends with Rule 1 Broken and Rule 2 Unproven", async () => {
  const result = await audit(await loadRecording(HAND_MADE));
  assert.deepEqual(result.verdicts, { R1: "Broken", R2: "Unproven" });
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0]!.scenario.id, "S1");
  assert.ok(result.transcript.includes("  R1: Broken"));
  assert.ok(result.transcript.some((l) => l.includes("S1: Rule check TRUE")));
});

test("a Scenario whose Rule check is not true on the Referee's own run ends as a Lead, not a Finding", async () => {
  const r = await loadRecording(HAND_MADE);
  const outcome = storedOutcome(r, 1); // The Attacker's run claimed it; the Referee's re-run does not agree.
  outcome.ruleCheckTrue = false;
  outcome.observations.after.views.user_recorded = "1000000000000000000000000";
  outcome.observations.failedReceipts = [];

  const result = await audit(r);
  assert.equal(result.findings.length, 0);
  assert.deepEqual(result.verdicts, { R1: "Unproven", R2: "Unproven" });
  const withScenario = result.leads.filter((l) => l.scenario);
  assert.equal(withScenario.length, 1);
  assert.equal(withScenario[0]!.rule, "R1");
  assert.equal(withScenario[0]!.scenario?.id, "S1");
  assert.ok(result.transcript.includes("  S1: Rule check false -> Lead on R1"));
});

test("a replay asked for an exchange that is not in the Recording fails with a clear message", async () => {
  const r = await loadRecording(HAND_MADE);
  r.exchanges = r.exchanges.filter((e) => e.agent !== "attacker");
  await assert.rejects(audit(r), {
    message: 'Replay asked for exchange #1 of agent "attacker", but the Recording holds only 0 for that agent.',
  });
});

test("each agent replays its own exchanges in order, so agents that ran side by side replay whatever order their calls finished in", async () => {
  const r = await loadRecording(HAND_MADE);
  const inOrder = await audit(r);
  r.exchanges = [r.exchanges[2]!, r.exchanges[1]!, r.exchanges[0]!, ...r.exchanges.slice(3)];
  const shuffled = await audit(r);
  assert.deepEqual(shuffled.verdicts, inOrder.verdicts);
  assert.deepEqual(shuffled.transcript, inOrder.transcript);
});

test("an invalid agent answer is retried, and an agent that never answers validly produces nothing", async () => {
  const r = await loadRecording(HAND_MADE);
  const [scout, rules, attackR1, attackR2] = r.exchanges;
  const bad = { agent: "attacker" as const, answer: '{"attempts": "nope"}', tokens: { input: 10, output: 5 } };

  r.exchanges = [scout!, rules!, bad, attackR1!, attackR2!];
  const retried = await audit(r);
  assert.deepEqual(retried.verdicts, { R1: "Broken", R2: "Unproven" });
  assert.ok(retried.transcript.some((l) => l.includes("invalid answer from attacker: attempts: expected an array")));

  r.exchanges = [scout!, rules!, bad, bad, bad, bad, bad, bad];
  r.toolchain = [];
  const gaveUp = await audit(r);
  assert.deepEqual(gaveUp.verdicts, { R1: "Unproven", R2: "Unproven" });
  assert.equal(gaveUp.transcript.filter((l) => l.includes("attacker gave no valid answer after 2 retries")).length, 2);
  assert.equal(gaveUp.payouts.filter((p) => p.to === "attacker").length, 0, "an Attacker that never answered is not paid");
});

test("the hand-made Recording pays R1's share to the Attacker and returns R2's, the Reporter's and nothing else to the payer", async () => {
  const payer = new FakePayer();
  const r = await loadRecording(HAND_MADE);
  const result = await runAudit(r.contract.path, replayPorts(r, payer));
  const NEAR = 10n ** 24n;
  const total = (who: string) =>
    result.payouts.filter((p) => p.to === who).reduce((s, p) => s + BigInt(p.yoctoNear), 0n);

  assert.equal(total("scout"), (NEAR * 5n) / 100n);
  assert.equal(total("rules"), (NEAR * 10n) / 100n);
  assert.equal(total("referee"), (NEAR * 20n) / 100n);
  assert.equal(total("attacker"), (NEAR * 30n) / 100n);
  // The Reporter and Prover do not run yet: the Reporter's 5% and Unproven R2's 30% go back.
  assert.equal(total("reporter"), 0n);
  assert.equal(total("prover"), 0n);
  assert.equal(total("payer"), (NEAR * 35n) / 100n);
  assert.equal(result.payouts.reduce((s, p) => s + BigInt(p.yoctoNear), 0n), NEAR);

  // Calculation is separate from sending: the fake payer recorded exactly what the Ledger worked out.
  assert.deepEqual(
    payer.sent,
    result.payouts.map((p) => ({ agent: p.to, yoctoNear: p.yoctoNear })),
  );
  assert.deepEqual(
    result.payouts.map((p) => p.hash),
    payer.sent.map((_, i) => `fake-${i + 1}`),
  );

  assert.ok(result.transcript.includes("== Payouts =="));
  assert.ok(result.transcript.some((l) => l.includes("SIMULATED") && l.includes("sends nothing")));
  assert.ok(result.transcript.includes("  attacker: 0.3 NEAR (R1 Broken) [fake-5]"));
  assert.ok(result.transcript.includes("  payer: 0.3 NEAR (R2 Unproven, its share returned) [fake-6]"));
});

test("the Referee's Payout is the same whatever the verdicts, and Payouts always sum to the Fee", async () => {
  const r = await loadRecording(HAND_MADE);
  storedOutcome(r, 1).ruleCheckTrue = false; // The Referee's re-run disagrees: R1 now Unproven too
  const result = await audit(r);
  assert.deepEqual(result.verdicts, { R1: "Unproven", R2: "Unproven" });
  const referee = result.payouts.filter((p) => p.to === "referee");
  assert.deepEqual(referee.map((p) => p.yoctoNear), [((10n ** 24n * 20n) / 100n).toString()]);
  assert.equal(result.payouts.reduce((s, p) => s + BigInt(p.yoctoNear), 0n), 10n ** 24n);
  assert.equal(result.payouts.filter((p) => p.to === "attacker").length, 0);
});

test("a Rules agent that never answers validly is not paid, and its share and the Rules pool return to the payer", async () => {
  const r = await loadRecording(HAND_MADE);
  const bad = { ...r.exchanges[1]!, answer: '{"rules": []}' };
  r.exchanges = [r.exchanges[0]!, bad, bad, bad];
  r.toolchain = [];
  const result = await audit(r);
  assert.deepEqual(result.verdicts, {});
  assert.equal(result.payouts.filter((p) => p.to === "rules").length, 0);
  assert.equal(result.payouts.filter((p) => p.to === "attacker").length, 0);
  // Rules agent 10% + Reporter 5% + the whole 60% pool.
  assert.equal(result.payouts.filter((p) => p.to === "payer").reduce((s, p) => s + BigInt(p.yoctoNear), 0n), (10n ** 24n * 75n) / 100n);
});
