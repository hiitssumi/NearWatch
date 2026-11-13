// Pieces of the hand-made Recording that several tests use directly.
import type { Rule, Scenario, ScenarioOutcome } from "../src/domain.ts";
import type { Recording } from "../src/replay/recording.ts";

export const HAND_MADE = new URL("../recordings/hand-made.json", import.meta.url).pathname;

export const handMadeRules = (r: Recording): Rule[] => JSON.parse(r.exchanges[1]!.answer).rules;

/** The one Scenario the hand-made Attacker writes: deposit, then withdraw to an account that does not exist. */
export function handMadeScenario(r: Recording): Scenario {
  const a = JSON.parse(r.exchanges[2]!.answer).attempts[0];
  return { id: "S1", rule: "R1", bugClass: "state not restored when a cross-contract call or transfer fails", setup: a.setup, call: a.call };
}

/** A stored runScenario outcome: index 0 is the Attacker's own run of S1, index 1 the Referee's re-run. */
export function storedOutcome(r: Recording, index: 0 | 1): ScenarioOutcome {
  const e = r.toolchain[index]!;
  if (e.op !== "runScenario" || !("outcome" in e)) throw new Error(`toolchain[${index}] is not a Scenario outcome`);
  return e.outcome;
}

// ---- The Formalization and the Prover, built from the hand-written Lean test material (test/lean) ----

import type { LeanOutcome } from "../src/domain.ts";
import type { ToolchainEntry } from "../src/replay/recording.ts";
import { readFileSync } from "node:fs";
import { CASES, type CaseName, FORMALIZATION, PROPERTIES, REFINED } from "./lean/cases.ts";

/** The Rules agent's Formalization answer: the hand-written first Formalization and the Properties of R1 and R2. */
export const formalAnswer = (formalization = FORMALIZATION, properties = PROPERTIES) => JSON.stringify({ formalization, properties });

/** A Prover answer. */
export const proofAnswer = (proof: string) => JSON.stringify({ proof });
export const PROOF_R1 = CASES["accept-R1"].body;
export const PROOF_R2 = CASES["accept-R2"].body;

const STORED: Record<string, LeanOutcome> = JSON.parse(
  readFileSync(new URL("./lean/lean-outcomes.json", import.meta.url), "utf8"),
).outcomes;

/** What real Lean said about one hand-written case (test/lean/lean-outcomes.json). */
export const storedLean = (name: CaseName): ToolchainEntry => ({ op: "checkLean", property: CASES[name].rule, outcome: STORED[name]! });

/** The Rules agent's Refinement answer: the hand-written Refinement of withdraw, with R1's Property unchanged. */
export const refinementAnswer = () => JSON.stringify({ formalization: REFINED, statement: PROPERTIES[0]!.statement });

/** A stored Lean outcome for `rule`: accepted, or Lean's errors. A statement check (placeholder proof) reports sorryAx. */
export function lean(rule: string, result: "ok" | "statement" | string, ms?: number): ToolchainEntry {
  const outcome: LeanOutcome =
    result === "ok"
      ? { ok: true, errors: "", axioms: ["propext", "Quot.sound"] }
      : result === "statement"
        ? { ok: true, errors: "", axioms: ["sorryAx"] }
        : { ok: false, errors: result, axioms: [] };
  return { op: "checkLean", property: rule, outcome: ms === undefined ? outcome : { ...outcome, ms } };
}
