// Seam 1, the Formalization and the Prover: run from Recordings built on the hand-made one, with the
// hand-written Lean test material standing in for the Rules agent's and the Prover's answers.
import assert from "node:assert/strict";
import { test } from "node:test";
import { runAudit } from "../src/audit.ts";
import type { AgentName } from "../src/domain.ts";
import { RecordingGateway } from "../src/llm/recording.ts";
import { loadRecording, type Recording, replayPorts, type ToolchainEntry } from "../src/replay/recording.ts";
import { FORMALIZATION, PROPERTIES } from "./lean/cases.ts";
import { formalAnswer, HAND_MADE, lean, PROOF_R1, PROOF_R2, proofAnswer } from "./hand-made.ts";

const skipAll = JSON.stringify({ attempts: [], skip: [1, 2, 3, 4, 5, 6, 7].map((c) => ({ bugClass: c, reason: "does not apply" })) });
const tokens = { input: 3000, output: 400 };

/** The hand-made Scout and Rules, then the given Formalization answers, an Attacker that skips everything, and the Prover's answers. */
async function recording(
  formal: string[],
  prover: (string | { answer: string; ms: number })[],
  toolchain: ToolchainEntry[],
): Promise<Recording> {
  const r = await loadRecording(HAND_MADE);
  const ex = (agent: AgentName, answer: string, ms?: number) => ({ agent, answer, tokens, usd: 0.02, ...(ms === undefined ? {} : { ms }) });
  r.exchanges = [
    r.exchanges[0]!,
    r.exchanges[1]!,
    ...formal.map((a) => ex("rules", a)),
    ex("attacker", skipAll),
    ex("attacker", skipAll),
    ...prover.map((p) => (typeof p === "string" ? ex("prover", p) : ex("prover", p.answer, p.ms))),
  ];
  r.toolchain = toolchain;
  return r;
}

async function audit(r: Recording) {
  const ports = replayPorts(r);
  const llm = new RecordingGateway(ports.llm);
  const result = await runAudit(r.contract.path, { ...ports, llm }, { prover: true });
  const prompts = (agent: AgentName) => llm.exchanges.filter((e) => e.agent === agent).map((e) => e.prompt!);
  return { result, prompts };
}

const compiles = [lean("R1", "statement"), lean("R2", "statement")];

test("the Rules agent writes a Formalization and a Property per Rule; the Prover gets the statement and supplies only the body; the Referee re-checks it", async () => {
  const r = await recording(
    [formalAnswer()],
    [proofAnswer(PROOF_R1), proofAnswer(PROOF_R2)],
    [...compiles, lean("R1", "ok"), lean("R2", "ok"), lean("R1", "ok"), lean("R2", "ok")],
  );
  const { result, prompts } = await audit(r);

  const formal = prompts("rules")[1]!;
  assert.match(formal, /Every contract call is ONE indivisible step/);
  assert.match(formal, /One Property for each Rule/);
  for (const rule of ["R1", "R2"]) assert.ok(formal.includes(`${rule}: `), `the Rules agent sees ${rule}`);

  const p = prompts("prover")[0]!;
  assert.ok(p.includes(FORMALIZATION.trimEnd()), "the Formalization");
  assert.ok(p.includes(`theorem property_R1 :\n    ${PROPERTIES[0]!.statement} := by\n  <YOUR PROOF BODY>`), "the statement, fixed");
  assert.match(p, /You write only the proof body/);

  assert.equal(result.formalization, FORMALIZATION);
  assert.deepEqual(result.properties, PROPERTIES);
  assert.deepEqual(result.proofs.map((c) => [c.rule, c.accepted]), [["R1", true], ["R2", true]]);
  assert.deepEqual(result.verdicts, { R1: "Proven", R2: "Proven" });
  assert.ok(result.transcript.includes("  proof of R1: ACCEPTED (Lean accepted it; axioms: propext, Quot.sound)"));
  assert.ok(result.payouts.some((p) => p.to === "prover"), "the Prover is paid for Proven Rules");
});

test("each Prover round's tokens, dollars and time are in the transcript, and Lean's errors go back to the Prover", async () => {
  const errors = "property_R1.lean:43:4: error: unsolved goals\ncase deposit\ns : State";
  const r = await recording(
    [formalAnswer()],
    [{ answer: proofAnswer("intro s c a\nsimp"), ms: 41_000 }, { answer: proofAnswer(PROOF_R1), ms: 30_000 }, proofAnswer(PROOF_R2)],
    [...compiles, lean("R1", errors, 900), lean("R1", "ok", 1200), lean("R2", "ok"), lean("R1", "ok"), lean("R2", "ok")],
  );
  const { result, prompts } = await audit(r);
  assert.ok(prompts("prover")[1]!.includes(`intro s c a\nsimp\n--- failed: Lean's errors:\n${errors}`));
  assert.ok(result.transcript.includes("  R1 round 1 (3000 in, 400 out, $0.0200, 41.9 s): rejected, Lean: property_R1.lean:43:4: error: unsolved goals"));
  assert.ok(result.transcript.includes("  R1 round 2 (3000 in, 400 out, $0.0200, 31.2 s): Lean accepts it -> submitted to the Referee"));
  assert.deepEqual(result.verdicts, { R1: "Proven", R2: "Proven" });
});

test("a Property that does not compile sends Lean's errors back to the Rules agent, and the Prover starts once it compiles", async () => {
  const errors = "property_R2.lean:41:20: error: unknown identifier 'balanc'";
  const r = await recording(
    [formalAnswer(), formalAnswer()],
    [proofAnswer(PROOF_R1), proofAnswer(PROOF_R2)],
    [lean("R1", "statement"), lean("R2", errors), ...compiles, lean("R1", "ok"), lean("R2", "ok"), lean("R1", "ok"), lean("R2", "ok")],
  );
  const { result, prompts } = await audit(r);
  assert.ok(prompts("rules")[2]!.includes(`Property for R2 (stated as a theorem with a placeholder proof). Lean's errors:\n${errors}`));
  assert.ok(result.transcript.includes(`  Formalization attempt 1 does not compile: Lean could not compile the Formalization with the Property for R2 (stated as a theorem with a placeholder proof). Lean's errors:`));
  assert.deepEqual(result.verdicts, { R1: "Proven", R2: "Proven" });
});

test("after two retries without a Formalization that compiles there is nothing to prove, and the Prover is not asked", async () => {
  const bad = lean("R1", "property_R1.lean:3:0: error: unexpected token");
  const r = await recording([formalAnswer(), formalAnswer(), formalAnswer()], [], [bad, bad, bad]);
  const { result, prompts } = await audit(r);
  assert.equal(prompts("prover").length, 0);
  assert.equal(result.formalization, null);
  assert.ok(result.transcript.includes("  (no Formalization to prove anything against)"));
  assert.deepEqual(result.verdicts, { R1: "Unproven", R2: "Unproven" });
  assert.ok(!result.payouts.some((p) => p.to === "prover"), "the Prover did not run, so its shares go back");
});

test("a Formalization that would run code, or a placeholder proof, is rejected before Lean sees it", async () => {
  const evil = `${FORMALIZATION}\n#eval IO.Process.run { cmd := "touch", args := #["/tmp/x"] }`;
  const r = await recording(
    [formalAnswer(evil), formalAnswer()],
    [proofAnswer("sorry"), proofAnswer(PROOF_R1), proofAnswer(PROOF_R2)],
    // No Lean outcome for the screened Formalization or the placeholder proof: Lean is never asked.
    [...compiles, lean("R1", "ok"), lean("R2", "ok"), lean("R1", "ok"), lean("R2", "ok")],
  );
  const { result, prompts } = await audit(r);
  assert.match(prompts("rules")[2]!, /the Formalization contains the Lean command `#eval`; it may contain only definitions/);
  assert.match(prompts("prover")[1]!, /--- failed: the proof uses the placeholder `sorry`/);
  assert.deepEqual(result.verdicts, { R1: "Proven", R2: "Proven" });
});

test("the Prover stops after twelve rounds on a Property, and that Property has no proof", async () => {
  const no = (n: number) => Array.from({ length: n }, () => proofAnswer("simp"));
  const err = lean("R1", "property_R1.lean:43:2: error: simp made no progress");
  const r = await recording([formalAnswer()], [...no(12), proofAnswer(PROOF_R2)], [...compiles, ...Array(12).fill(err), lean("R2", "ok"), lean("R2", "ok")]);
  const { result, prompts } = await audit(r);
  assert.equal(prompts("prover").length, 13);
  assert.ok(result.transcript.includes("  R1: no proof within the budget (stopped by 12 rounds, 0.0 s used)"));
  assert.deepEqual(result.verdicts, { R1: "Unproven", R2: "Proven" });
});

test("the Prover stops after ten minutes on a Property, counted from the recorded time of each call and check", async () => {
  const slow = { answer: proofAnswer("simp"), ms: 239_000 };
  const err = lean("R1", "property_R1.lean:43:2: error: simp made no progress", 1000);
  const r = await recording([formalAnswer()], [slow, slow, slow, proofAnswer(PROOF_R2)], [...compiles, err, err, err, lean("R2", "ok"), lean("R2", "ok")]);
  const { result, prompts } = await audit(r);
  assert.equal(prompts("prover").length, 4, "three rounds of R1 (12 minutes), then R2");
  assert.ok(result.transcript.includes("  R1: no proof within the budget (stopped by 10 minutes, 720.0 s used)"));
  assert.deepEqual(result.verdicts, { R1: "Unproven", R2: "Proven" });
});

test("the Referee re-checks every proof itself: one its own check rejects counts as no proof", async () => {
  const r = await recording(
    [formalAnswer()],
    [proofAnswer(PROOF_R1), proofAnswer(PROOF_R2)],
    [...compiles, lean("R1", "ok"), lean("R2", "ok"), lean("R1", "property_R1.lean:50:0: error: type mismatch"), lean("R2", "ok")],
  );
  const { result } = await audit(r);
  assert.deepEqual(result.verdicts, { R1: "Unproven", R2: "Proven" });
  assert.ok(result.transcript.includes("  proof of R1: REJECTED (Lean did not accept the file)"));
});
