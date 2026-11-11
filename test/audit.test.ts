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
  const outcome = r.toolchain[0]!.outcome;
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
