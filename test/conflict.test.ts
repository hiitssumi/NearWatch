// Seam 1, Conflicts and Refinements (ticket 08): run from Recordings built on the hand-made one, with the
// hand-written Lean test material standing in for the Rules agent's and the Prover's answers.
import assert from "node:assert/strict";
import { test } from "node:test";
import { auditOptionsFrom, MAX_REFINEMENTS, runAudit } from "../src/audit.ts";
import type { AgentName, Rule } from "../src/domain.ts";
import { RecordingGateway } from "../src/llm/recording.ts";
import { loadRecording, type Recording, replayPorts, type ToolchainEntry } from "../src/replay/recording.ts";
import { rulesAnswer } from "../src/schemas.ts";
import { InvalidAnswer } from "../src/validate.ts";
import { counterexampleAnswer, formalAnswer, HAND_MADE, lean, PROOF_R1, PROOF_R2, proofAnswer, refinementAnswer, storedLean } from "./hand-made.ts";
import { COUNTEREXAMPLE_R1, R1_REFINED, SUCCESS_BRANCH } from "./lean/cases.ts";

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

async function audit(r: Recording, counterexamples = false) {
  const ports = replayPorts(r);
  const llm = new RecordingGateway(ports.llm);
  const result = await runAudit(r.contract.path, { ...ports, llm }, { prover: true, conflicts: true, counterexamples });
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

// ---- After the Refinement: a counterexample (ticket 17) ----

const same = JSON.stringify({ samePath: true, why: "Both withdraw to an account whose transfer fails, and nothing restores the balance." });
/** Up to the Refinement that resolves the Conflict, with R1 restated over withdraw's start and resolve steps. */
const upToRefinement = [...provedBoth, { agent: "referee" as const, answer: explanation }, { agent: "rules" as const, answer: refinementAnswer(R1_REFINED.statement) }];
const leanUpToRefinement = [...statements, ...proverAndReferee, storedLean("restated-statement"), storedLean("after-restated")];

test("after the Refinement, the Prover gives a counterexample that Lean confirms, shown beside the Finding on the same path", async () => {
  const r = await recording(
    [...upToRefinement, { agent: "prover", answer: counterexampleAnswer(), usd: 0.03 }, { agent: "referee", answer: same }],
    "finding",
    // The Prover's own check of the counterexample, then the Referee's.
    [...leanUpToRefinement, storedLean("counterexample-R1"), storedLean("counterexample-R1")],
  );
  const { result, prompts } = await audit(r, true);
  const [c] = result.conflicts;
  assert.equal(c!.outcome, "resolved");
  const cx = c!.afterRefinement!.counterexample!;
  assert.equal(cx.refinement, 1);
  assert.deepEqual(cx.witnesses, COUNTEREXAMPLE_R1.witnesses);
  assert.equal(cx.check.accepted, true);
  assert.equal(cx.check.rule, "R1");
  assert.match(cx.check.body, /^intro h\nhave hw := h \(\{ balance := fun _ => 1,[^\n]*\("ghost"\) \(1\) \(false\) \(rfl\)\nsimp \[step, drop\] at hw$/);
  assert.equal(cx.samePath, true);
  assert.equal(c!.afterRefinement!.proof, null);

  const t = result.transcript;
  const at = (line: string) => t.findIndex((l) => l.includes(line));
  for (const line of [
    "== Prover: the restated R1 against Refinement 1 ==",
    "R1 round 1 (3000 in, 400 out, $0.0300, 0.0 s): a counterexample; Lean confirms it -> submitted to the Referee",
    "Cost of this step: $0.0300",
    "== Referee: re-check of the Prover's counterexample to the restated R1 ==",
    "R1: the counterexample HOLDS (Lean confirms the Property is false for these values; axioms: propext, Quot.sound).",
    "theorem property_R1_counterexample : ¬ (restated R1)",
    "Finding S1 (Attacker, real contract):",
    `Counterexample (Prover, Refinement 1, in its own words): ${COUNTEREXAMPLE_R1.path}`,
    "Same path: YES. Both withdraw to an account whose transfer fails, and nothing restores the balance. (Compared by an LLM; it decides nothing.)",
    "The Attacker and the Prover agree on why R1 is broken.",
  ]) {
    assert.ok(at(line) >= 0, `the transcript shows: ${line}`);
  }
  assert.ok(at("NO LONGER PASSES") < at("== Prover: the restated") && at("Same path: YES") < at("R1 ends Broken"));

  // The Prover sees the Finding, the refined file, and both ways to answer; the Referee compares with the Finding.
  const asked = prompts("prover").at(-1)!;
  assert.match(asked, /"receiver_id":"nobody-here"/);
  assert.match(asked, /theorem property_R1_counterexample :\n    ¬ \(∀ \(s : State\) \(c r : Account\)/);
  assert.match(asked, /have hw := h \(<VALUE 1>\) \(<VALUE 2>\) \(\.\.\.\)/);
  assert.match(prompts("referee").at(-1)!, /The Prover describes its steps as: alice withdraws 1 to ghost/);

  // The verdicts and Payouts are what they are without the step: a Finding already made R1 Broken.
  const without = await audit(r);
  assert.deepEqual(result.verdicts, without.result.verdicts);
  assert.deepEqual(result.payouts, without.result.payouts);
});

test("with no counterexample within the Prover's rounds, the Audit's result is unchanged", async () => {
  // Round 1 puts a placeholder in a value, which is refused before Lean; the other 11 use the success branch, which Lean rejects.
  const sorry = { ...COUNTEREXAMPLE_R1, witnesses: ["sorry", ...COUNTEREXAMPLE_R1.witnesses.slice(1)] };
  const r = await recording(
    [
      ...upToRefinement,
      { agent: "prover", answer: counterexampleAnswer(sorry) },
      ...Array.from({ length: 11 }, () => ({ agent: "prover" as const, answer: counterexampleAnswer(SUCCESS_BRANCH) })),
    ],
    "finding",
    [...leanUpToRefinement, ...Array.from({ length: 11 }, () => storedLean("success-branch"))],
  );
  const { result, prompts } = await audit(r, true);
  const t = result.transcript;
  assert.ok(t.includes("  R1 round 1 (3000 in, 400 out, 0.0 s): rejected, a value or the tactic block uses the placeholder `sorry`"));
  assert.ok(t.some((l) => /^ {2}R1 round 2 .*: rejected, Lean: .*error: unsolved goals/.test(l)));
  assert.ok(t.includes("  R1: no proof and no counterexample within the budget (stopped by 12 rounds, 0.0 s used)"));
  assert.ok(t.includes("  The Audit's result is unchanged."));
  assert.deepEqual(result.conflicts[0]!.afterRefinement, { counterexample: null, proof: null });
  assert.match(prompts("prover").at(-1)!, /Your earlier attempts \(latest last\)[\s\S]*values: [\s\S]*\| true \| rfl/);
  const without = await audit(r);
  assert.deepEqual(result.verdicts, without.result.verdicts);
  assert.deepEqual(result.payouts, without.result.payouts);
});

test("a proof of the restated Property instead is re-checked, and changes nothing either", async () => {
  const r = await recording(
    [...upToRefinement, { agent: "prover", answer: proofAnswer("simp [step]") }],
    "finding",
    [...leanUpToRefinement, lean("R1", "ok"), lean("R1", "ok")],
  );
  const { result } = await audit(r, true);
  const after = result.conflicts[0]!.afterRefinement!;
  assert.equal(after.counterexample, null);
  assert.equal(after.proof?.accepted, true);
  assert.ok(result.transcript.includes("  The Refinement still does not show what the Finding shows. The Audit's result is unchanged."));
  assert.deepEqual(result.verdicts, { R1: "Broken", R2: "Proven" });
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

// ---- The live run (ticket 08) ----

test("the live Recording replays: one Conflict on the withdraw Rule, one Refinement, the old proof failing against it", async () => {
  const r = await loadRecording(new URL("../recordings/live-conflict-buggy-vault.json", import.meta.url).pathname);
  const result = await runAudit(r.contract.path, replayPorts(r), auditOptionsFrom(r.settings));
  // The Rules agent numbered the spec's Rule 1 (withdraw) R3, and the owner Rule R4.
  assert.deepEqual(result.verdicts, { R1: "Proven", R2: "Proven", R3: "Broken", R4: "Proven", R5: "Proven" });
  assert.equal(result.conflicts.length, 1);
  const [c] = result.conflicts;
  assert.equal(c!.rule, "R3");
  assert.equal(c!.finding, "S8");
  assert.equal(c!.outcome, "resolved");
  assert.equal(c!.refinements.length, 1);
  assert.equal(c!.refinements[0]!.method, "withdraw");
  assert.equal(c!.refinements[0]!.recheck.accepted, false);
  assert.match(c!.refinements[0]!.property.statement, /withdrawStart/);
  assert.ok(result.transcript.includes("  R3 ends Broken: a Finding outranks a proof."));
  assert.ok(result.payouts.some((p) => p.to === "attacker" && p.reason === "R3 Broken"));
  assert.equal(r.settings.conflicts, true);
});

// ---- The live run (ticket 17), continuing ticket 08's ----

test("the live counterexample Recording replays: the Prover's counterexample to the restated withdraw Rule holds and follows the Finding's path", async () => {
  const r = await loadRecording(new URL("../recordings/live-counterexample-buggy-vault.json", import.meta.url).pathname);
  // Everything up to the Refinement is ticket 08's run, replayed; the counterexample and the comparison were live.
  assert.deepEqual(r.settings.continuedFrom, {
    recording: "recordings/live-conflict-buggy-vault.json",
    replayedExchanges: 23,
    replayedPromptsChanged: 0,
    liveExchanges: 2,
    replayedToolchain: 46,
    liveToolchain: 2,
  });
  assert.equal(r.settings.counterexamples, true);
  const result = await runAudit(r.contract.path, replayPorts(r), auditOptionsFrom(r.settings));
  assert.deepEqual(result.verdicts, { R1: "Proven", R2: "Proven", R3: "Broken", R4: "Proven", R5: "Proven" });
  const [c] = result.conflicts;
  assert.equal(c!.outcome, "resolved");
  const cx = c!.afterRefinement!.counterexample!;
  assert.equal(cx.check.accepted, true);
  assert.deepEqual(cx.witnesses.slice(1), ['"alice"', "1", '"ghost"', "false", "rfl"]);
  assert.equal(cx.samePath, true);
  assert.ok(result.transcript.includes("  The Attacker and the Prover agree on why R3 is broken."));
  // The step changes no verdict and no Payout: ticket 08's Recording pays the same.
  const t08 = await loadRecording(new URL("../recordings/live-conflict-buggy-vault.json", import.meta.url).pathname);
  const before = await runAudit(t08.contract.path, replayPorts(t08), auditOptionsFrom(t08.settings));
  assert.deepEqual(result.payouts, before.payouts);
});

test("when one side fails, the other side stops at its next call, and the Audit reports the first failure", async () => {
  // The Attacker's first exchange is missing, so its side fails at once; the Prover's side has all its answers.
  const r = await recording(provedBoth, "finding", [...statements, ...proverAndReferee]);
  r.exchanges = r.exchanges.filter((e) => e.agent !== "attacker");
  const ports = replayPorts(r);
  const asked: string[] = [];
  let leanChecks = 0;
  const llm = { ask: (agent: AgentName, prompt: string) => (asked.push(agent), ports.llm.ask(agent, prompt)) };
  const toolchain = { ...ports.toolchain, checkLean: (...a: Parameters<typeof ports.toolchain.checkLean>) => (leanChecks++, ports.toolchain.checkLean(...a)) };
  await assert.rejects(
    runAudit(r.contract.path, { ...ports, llm, toolchain }, { prover: true, conflicts: true }),
    (e: Error) => /Replay asked for exchange #1 of agent "attacker"/.test(e.message),
  );
  // The Formalization's call and its first Lean check were already under way when the Attacker failed; after
  // them the Prover's side stopped: the Prover was never asked, and nothing more was checked.
  assert.deepEqual(asked, ["scout", "rules", "attacker", "rules"]);
  assert.ok(leanChecks <= 1, `at most the check already under way, not ${leanChecks}`);
});
