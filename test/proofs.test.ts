// Seam 1, proofs: the Referee's proof rules, run from Recordings whose Lean outcomes were stored from
// real Lean (test/lean/lean-outcomes.json). Needs only Node. The Lean material is test-only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { LeanOutcome, Proof, Rule, Scenario } from "../src/domain.ts";
import { assembleLeanFile, readAxiomReport } from "../src/lean.ts";
import { judgeLeanOutcome, screenProofBody } from "../src/proof-rules.ts";
import { referee } from "../src/referee.ts";
import { loadRecording, type Recording, replayPorts, type ToolchainEntry } from "../src/replay/recording.ts";
import { HAND_MADE, handMadeRules, handMadeScenario } from "./hand-made.ts";
import { CASES, type CaseName, FORMALIZATION, FORMALIZATION_WITH_AXIOM, PROPERTIES } from "./lean/cases.ts";

const STORED: Record<CaseName, LeanOutcome> = JSON.parse(
  readFileSync(new URL("./lean/lean-outcomes.json", import.meta.url), "utf8"),
).outcomes;

const proof = (name: CaseName): Proof => ({ rule: CASES[name].rule, body: CASES[name].body });
const lean = (name: CaseName): ToolchainEntry => ({ op: "checkLean", property: CASES[name].rule, outcome: STORED[name] });

/** The hand-made Recording's Rules and Scenario, with the given toolchain outcomes stored after its own. */
async function setup(extra: ToolchainEntry[], { withFinding = true } = {}) {
  const r: Recording = await loadRecording(HAND_MADE);
  const rules: Rule[] = handMadeRules(r);
  const scenarios: Scenario[] = withFinding ? [handMadeScenario(r)] : [];
  // Only the Referee's own run of S1 (index 1): this calls the Referee directly, without the Attacker.
  r.toolchain = [...(withFinding ? [r.toolchain[1]!] : []), ...extra];
  const transcript: string[] = [];
  const run = (proofs: Proof[], formalization = FORMALIZATION) =>
    referee(r.contract.path, rules, scenarios, replayPorts(r).toolchain, (l) => transcript.push(l), {
      formalization,
      properties: PROPERTIES,
      proofs,
    });
  return { run, transcript };
}

test("a complete proof is accepted, and the Rule ends Proven when no Finding stands", async () => {
  const { run, transcript } = await setup([lean("accept-R1"), lean("accept-R2")], { withFinding: false });
  const result = await run([proof("accept-R1"), proof("accept-R2")]);
  assert.deepEqual(result.verdicts, { R1: "Proven", R2: "Proven" });
  assert.deepEqual(result.proofs.map((p) => p.accepted), [true, true]);
  assert.ok(transcript.some((l) => l.includes("proof of R1: ACCEPTED")));
});

test("a Finding outranks an accepted proof: Rule 1 Broken, Rule 2 Proven", async () => {
  const { run } = await setup([lean("accept-R1"), lean("accept-R2")]);
  const result = await run([proof("accept-R1"), proof("accept-R2")]);
  assert.deepEqual(result.verdicts, { R1: "Broken", R2: "Proven" });
  assert.equal(result.proofs[0]!.accepted, true);
});

test("a proof with a placeholder is rejected before Lean is asked", async () => {
  // No Lean outcome is stored: the replay toolchain would fail if the Referee asked for one.
  const { run } = await setup([], { withFinding: false });
  const result = await run([proof("placeholder")]);
  assert.equal(result.proofs[0]!.accepted, false);
  assert.match(result.proofs[0]!.reason, /placeholder `sorry`/);
  assert.equal(result.verdicts.R1, "Unproven");
  for (const p of ["admit", "  exact sorry", "exact (sorryAx _ false)"]) assert.ok(screenProofBody(p), p);
  // Lean's own report of a placeholder is rejected too.
  assert.match(judgeLeanOutcome(STORED.placeholder)!, /sorryAx/);
});

test("a proof that uses an axiom outside the standard set is rejected", async () => {
  const { run } = await setup([lean("added-axiom")], { withFinding: false });
  const result = await run([proof("added-axiom")], FORMALIZATION_WITH_AXIOM);
  assert.equal(result.proofs[0]!.accepted, false);
  assert.match(result.proofs[0]!.reason, /outside the standard set: vault_cheat/);
  assert.equal(result.verdicts.R1, "Unproven");
});

test("a proof body cannot change the statement being proved", async () => {
  // Declaring a new theorem is rejected outright.
  const { run } = await setup([], { withFinding: false });
  const restated = await run([proof("restated")]);
  assert.equal(restated.proofs[0]!.accepted, false);
  assert.match(restated.proofs[0]!.reason, /contains `theorem`/);
  for (const body of ["trivial\naxiom x : False", "#exit", "trivial\nend Foo"]) assert.ok(screenProofBody(body), body);

  // Changing the goal inside the proof is refused by Lean; its error text comes back unchanged.
  const changed = await (await setup([lean("changed-goal")], { withFinding: false })).run([proof("changed-goal")]);
  assert.equal(changed.proofs[0]!.accepted, false);
  assert.equal(changed.proofs[0]!.reason, "Lean did not accept the file");
  assert.equal(changed.proofs[0]!.outcome!.errors, STORED["changed-goal"].errors);
  assert.match(changed.proofs[0]!.outcome!.errors, /^property_R1\.lean:\d+:\d+: error: 'show' tactic failed/);
});

test("the statement comes from the Property, never from the proof body", () => {
  const file = assembleLeanFile("-- F", PROPERTIES[0]!, "intro s c a\nomega", "MARK");
  assert.ok(file.startsWith("-- F\n\ntheorem property_R1 :\n    ∀ (s : State)"));
  assert.ok(file.includes(":= by\n  intro s c a\n  omega\n"));
  assert.ok(file.trimEnd().endsWith('#print axioms property_R1\n#eval IO.println "MARK"'));
});

test("only the axiom report followed by the trailer's marker counts", () => {
  const fake = "'property_R1' does not depend on any axioms\n";
  assert.equal(readAxiomReport(fake, "property_R1", "MARK"), null);
  const real = `${fake}'property_R1' depends on axioms: [propext, vault_cheat]\nMARK\n`;
  assert.deepEqual(readAxiomReport(real, "property_R1", "MARK"), ["propext", "vault_cheat"]);
});

test("a replay asked for a proof check that is not next in the Recording fails clearly", async () => {
  const { run } = await setup([lean("accept-R2")], { withFinding: false });
  await assert.rejects(run([proof("accept-R1")]), {
    message: "Replay asked for Lean check #1 for the proof of R1, but the Recording has the proof of R2 there.",
  });
});
