// Seam 1: the Audit, run from a Recording. Needs only Node.
import assert from "node:assert/strict";
import { test } from "node:test";
import { runAudit } from "../src/audit.ts";
import { FakePayer, loadRecording, type Recording, replayPorts } from "../src/replay/recording.ts";

const HAND_MADE = new URL("../recordings/hand-made.json", import.meta.url).pathname;

const audit = (r: Recording) => runAudit(r.contract.path, replayPorts(r, new FakePayer()));

test("the hand-made Recording ends with Rule 1 Broken and Rule 2 Unproven", async () => {
  const result = await audit(await loadRecording(HAND_MADE));
  assert.deepEqual(result.verdicts, { R1: "Broken", R2: "Unproven" });
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0]!.scenario.id, "S1");
  assert.ok(result.transcript.includes("  R1: Broken"));
  assert.ok(result.transcript.some((l) => l.includes("S1: Rule check TRUE")));
});

test("a Scenario that does not make the Rule check true ends as a Lead, not a Finding", async () => {
  const r = await loadRecording(HAND_MADE);
  const entry = r.toolchain[0]!;
  assert.equal(entry.op, "runScenario");
  const outcome = entry.outcome;
  outcome.ruleCheckTrue = false;
  outcome.observations.after.views.user_recorded = "1000000000000000000000000";
  outcome.observations.failedReceipts = [];

  const result = await audit(r);
  assert.equal(result.findings.length, 0);
  assert.deepEqual(result.verdicts, { R1: "Unproven", R2: "Unproven" });
  assert.equal(result.leads.length, 1);
  assert.equal(result.leads[0]!.rule, "R1");
  assert.equal(result.leads[0]!.scenario?.id, "S1");
});

test("a replay asked for an exchange that is not in the Recording fails with a clear message", async () => {
  const r = await loadRecording(HAND_MADE);
  r.exchanges = r.exchanges.filter((e) => e.agent !== "attacker");
  await assert.rejects(audit(r), {
    message: 'Replay asked for LLM exchange #3 (agent "attacker"), but the Recording holds only 2 exchange(s).',
  });
});

test("a replay whose next exchange belongs to another agent fails with a clear message", async () => {
  const r = await loadRecording(HAND_MADE);
  r.exchanges = [r.exchanges[1]!, r.exchanges[0]!, r.exchanges[2]!];
  await assert.rejects(audit(r), /exchange #1 from agent "scout", but the Recording has agent "rules"/);
});

test("an invalid agent answer is retried, and an agent that never answers validly produces nothing", async () => {
  const r = await loadRecording(HAND_MADE);
  const [scout, rules, attacker] = r.exchanges;
  const bad = { agent: "attacker" as const, answer: '{"scenarios": "nope"}', tokens: { input: 10, output: 5 } };

  r.exchanges = [scout!, rules!, bad, attacker!];
  const retried = await audit(r);
  assert.deepEqual(retried.verdicts, { R1: "Broken", R2: "Unproven" });
  assert.ok(retried.transcript.some((l) => l.includes("invalid answer from attacker: scenarios: expected an array")));

  r.exchanges = [scout!, rules!, bad, bad, bad];
  r.toolchain = [];
  const gaveUp = await audit(r);
  assert.deepEqual(gaveUp.verdicts, { R1: "Unproven", R2: "Unproven" });
  assert.ok(gaveUp.transcript.some((l) => l.includes("attacker gave no valid answer after 2 retries")));
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
  r.toolchain[0]!.outcome.ruleCheckTrue = false; // R1 now Unproven too
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
