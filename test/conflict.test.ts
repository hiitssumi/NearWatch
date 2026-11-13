// Seam 1, Conflicts and Refinements (ticket 08): run from Recordings built on the hand-made one, with the
// hand-written Lean test material standing in for the Rules agent's and the Prover's answers.
import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_REFINEMENTS, runAudit } from "../src/audit.ts";
import type { AgentName, Rule } from "../src/domain.ts";
import { RecordingGateway } from "../src/llm/recording.ts";
import { loadRecording, type Recording, replayPorts, type ToolchainEntry } from "../src/replay/recording.ts";
import { rulesAnswer } from "../src/schemas.ts";
import { InvalidAnswer } from "../src/validate.ts";
import { formalAnswer, HAND_MADE, lean, PROOF_R1, PROOF_R2, proofAnswer, refinementAnswer, storedLean } from "./hand-made.ts";

const tokens = { input: 3000, output: 400 };
const explanation = JSON.stringify({ explanation: "The transfer failed and nothing restored the balance." });

/**
 * The hand-made Scout, Rules and Attacker (whose S1 is a Finding against R1), the first Formalization,
 * then the given Prover, Referee and Rules agent answers after it. Toolchain entries are listed per kind.
 */
async function recording(after: { agent: AgentName; answer: string; usd?: number }[], scenarios: "finding" | "none", leanChecks: ToolchainEntry[]): Promise<Recording> {
  const r = await loadRecording(HAND_MADE);
  const [scout, rules, attackR1, attackR2] = r.exchanges;
  const [attackerRun, refereeRun] = r.toolchain;
  // With no Finding, the Attacker gets a second round on R1, where class 1 is still open: it skips it.
  const skip1 = { agent: "attacker" as const, answer: JSON.stringify({ attempts: [], skip: [{ bugClass: 1, reason: "tried" }] }), tokens };
  const attacker = scenarios === "none" ? [attackR1!, skip1, attackR2!] : [attackR1!, attackR2!];
  r.exchanges = [scout!, rules!, { agent: "rules", answer: formalAnswer(), tokens }, ...attacker, ...after.map((a) => ({ tokens, ...a }))];
  if (scenarios === "none") {
    // The Attacker tries S1 but it does not break R1, so there is no Finding.
    const miss = structuredClone(attackerRun!) as Extract<ToolchainEntry, { op: "runScenario"; outcome: unknown }>;
    miss.outcome.ruleCheckTrue = false;
    r.toolchain = [miss, ...leanChecks];
  } else r.toolchain = [attackerRun!, refereeRun!, ...leanChecks];
  return r;
}

async function audit(r: Recording) {
  const ports = replayPorts(r);
  const llm = new RecordingGateway(ports.llm);
  const result = await runAudit(r.contract.path, { ...ports, llm }, { prover: true, conflicts: true });
  const prompts = (agent: AgentName) => llm.exchanges.filter((e) => e.agent === agent).map((e) => e.prompt!);
  return { result, prompts };
}

const statements = [lean("R1", "statement"), lean("R2", "statement")];
const provedBoth = [proofAnswer(PROOF_R1), proofAnswer(PROOF_R2)].map((answer) => ({ agent: "prover" as const, answer }));
const proverAndReferee = [lean("R1", "ok"), lean("R2", "ok"), lean("R1", "ok"), lean("R2", "ok")];

test("a proof that still passes after two Refinements is withdrawn, and the Rule ends Broken", async () => {
  const r = await recording(
    [
      ...provedBoth,
      { agent: "referee", answer: explanation },
      { agent: "rules", answer: refinementAnswer() },
      { agent: "rules", answer: refinementAnswer() },
    ],
    "finding",
    // Each Refinement's statement compiles, and the old proof passes both re-checks.
    [...statements, ...proverAndReferee, lean("R1", "statement"), lean("R1", "ok"), lean("R1", "statement"), lean("R1", "ok")],
  );
  const { result, prompts } = await audit(r);

  assert.equal(MAX_REFINEMENTS, 2);
  assert.deepEqual(result.verdicts, { R1: "Broken", R2: "Proven" });
  assert.equal(result.conflicts.length, 1);
  const [c] = result.conflicts;
  assert.equal(c!.outcome, "withdrawn");
  assert.equal(c!.refinements.length, 2);
  assert.ok(c!.refinements.every((x) => x.recheck.accepted));
  assert.ok(result.transcript.includes("  R1: the old proof STILL PASSES against Refinement 2."));
  assert.ok(result.transcript.includes("  The proof still passes after 2 Refinements: it is withdrawn."));
  assert.ok(result.transcript.includes("  R1 ends Broken: a Finding outranks a proof."));
  const second = prompts("rules").at(-1)!;
  assert.match(second, /Your previous Refinement \(number 1\) still let that proof pass/);
  const r1 = result.payouts.find((p) => p.reason.startsWith("R1"));
  assert.equal(r1?.to, "attacker", "R1's share goes to the Attacker");
});

test("a Rule with a Finding and no proof, or a proof and no Finding, raises no Conflict", async () => {
  // The Prover answers R1 with placeholders until its rounds run out, and proves R2. S1 breaks R1.
  const placeholder = { agent: "prover" as const, answer: proofAnswer("sorry") };
  const r = await recording(
    [...Array.from({ length: 12 }, () => placeholder), { agent: "prover", answer: proofAnswer(PROOF_R2) }],
    "finding",
    [...statements, lean("R2", "ok"), lean("R2", "ok")],
  );
  const { result } = await audit(r);
  assert.deepEqual(result.verdicts, { R1: "Broken", R2: "Proven" });
  assert.deepEqual(result.conflicts, []);
  assert.ok(!result.transcript.some((l) => l.includes("CONFLICT")));
});

test("a proof with no Finding against its Rule raises no Conflict", async () => {
  const r = await recording(provedBoth, "none", [...statements, ...proverAndReferee]);
  const { result } = await audit(r);
  assert.deepEqual(result.verdicts, { R1: "Proven", R2: "Proven" });
  assert.deepEqual(result.conflicts, []);
});

test("with no Refinement that compiles, the Conflict stays unresolved and the Rule still ends Broken", async () => {
  const bad = JSON.stringify({ formalization: "#eval 1", statement: "True" });
  const r = await recording(
    [...provedBoth, { agent: "referee", answer: explanation }, ...Array.from({ length: 3 }, () => ({ agent: "rules" as const, answer: bad }))],
    "finding",
    [...statements, ...proverAndReferee],
  );
  const { result } = await audit(r);
  assert.deepEqual(result.verdicts, { R1: "Broken", R2: "Proven" });
  assert.equal(result.conflicts[0]!.outcome, "unresolved");
  assert.ok(result.transcript.includes("  No Refinement that compiles: the Conflict stays unresolved."));
});

test("the Refinement re-check is the real Lean outcome: the old proof fails against the hand-written Refinement", async () => {
  const r = await recording(
    [...provedBoth, { agent: "referee", answer: explanation }, { agent: "rules", answer: refinementAnswer() }],
    "finding",
    [...statements, ...proverAndReferee, storedLean("refined-statement"), storedLean("after-refinement")],
  );
  const { result } = await audit(r);
  const [c] = result.conflicts;
  assert.equal(c!.outcome, "resolved");
  assert.match(c!.refinements[0]!.recheck.outcome!.errors, /Alternative `withdrawStart` has not been provided/);
});

test("side by side, each side spends only its half of what was left under the cap, so one stopping never depends on the other", async () => {
  // The cap is $1 and the Scout and Rules agent spend nothing, so each side may spend $0.50. The Attacker's
  // first answer costs $0.60 and uses up its side; the Rules agent's Formalization and the Prover go on.
  const r = await recording(provedBoth, "finding", [...statements, ...proverAndReferee]);
  for (const e of r.exchanges) e.usd = e.agent === "attacker" ? 0.6 : 0.01;
  r.exchanges[0]!.usd = 0;
  r.exchanges[1]!.usd = 0;
  const ports = replayPorts(r);
  const result = await runAudit(r.contract.path, ports, { prover: true, spendCapUsd: 1 });
  const t = result.transcript;
  assert.ok(t.some((l) => l.includes("Spend cap reached for the Attacker's side: $0.6000 of its $0.50 share")));
  assert.ok(t.includes("  (spend cap: attacker not asked)"), "the Attacker is not asked about R2");
  assert.deepEqual(result.verdicts, { R1: "Broken", R2: "Proven" }, "the Prover's side was not stopped");
  assert.ok(t.some((l) => l.includes("CAP REACHED")));
});

// ---- Rule checks that compare accounts ----

const pauseRule = (condition: unknown): unknown => ({
  rules: [
    {
      id: "R1",
      text: "Only the owner may change the pause flag.",
      check: {
        methods: ["set_deposits_paused"],
        slots: [
          { name: "owner", kind: "view", describe: "the owner", bind: { view: { method: "owner", args: {} } } },
          { name: "paused", kind: "view", describe: "the flag", bind: { view: { method: "deposits_paused", args: {} } } },
          { name: "wallet", kind: "balance", describe: "the signer's NEAR", bind: { account: "$caller" } },
        ],
        condition,
      },
    },
  ],
});
const signerIsNot = (right: unknown, compare = "!=") => ({ compare, left: { account: "$caller" }, right });

test("a Rule check can say the signer is not the owner, and accounts are only compared as accounts", () => {
  const ok = rulesAnswer(pauseRule({ all: [signerIsNot({ slot: "owner", when: "before" }), { compare: "!=", left: { slot: "paused", when: "after" }, right: { slot: "paused", when: "before" } }] }), "");
  assert.deepEqual((ok.rules[0] as Rule).check.condition, {
    all: [signerIsNot({ slot: "owner", when: "before" }), { compare: "!=", left: { slot: "paused", when: "after" }, right: { slot: "paused", when: "before" } }],
  });
  rulesAnswer(pauseRule(signerIsNot({ account: "owner" })), "");
  for (const [condition, message] of [
    [signerIsNot({ slot: "owner", when: "before" }, "<"), /only be compared with "==" or "!="/],
    [signerIsNot({ number: "1" }), /another account or a view slot/],
    [signerIsNot({ slot: "wallet", when: "before" }), /another account or a view slot/],
    [{ compare: ">", left: { op: "add", left: { account: "$caller" }, right: { number: "1" } }, right: { number: "0" } }, /cannot be added or subtracted/],
    [signerIsNot({ account: "$signer" }), /is not a reference/],
  ] as const) {
    assert.throws(() => rulesAnswer(pauseRule(condition), ""), (e: Error) => e instanceof InvalidAnswer && message.test(e.message));
  }
});
