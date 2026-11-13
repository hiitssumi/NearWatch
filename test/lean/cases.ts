// Hand-written Lean test material for the proof rules (ticket 06). TEST-ONLY: none of it ever ships as
// an Audit's evidence. Plain Lean 4, no packages, no Mathlib.
//
// `npm run record-lean` re-checks every case with real Lean and rewrites lean-outcomes.json, the stored
// outcomes the fast tests replay.

import { readFileSync } from "node:fs";
import type { Property } from "../../src/domain.ts";

const here = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");

/** The first Formalization of the demo vault: every call is one step (docs/adr/0001). */
export const FORMALIZATION = here("vault-first.lean");
/** A Refinement of it: withdraw split into a start step and a resolve step with a success and a failure branch. */
export const REFINED = here("vault-refined.lean");
/** The same Formalization with an extra axiom a proof can lean on. */
export const FORMALIZATION_WITH_AXIOM = `${FORMALIZATION}\n${here("axiom-extra.lean")}`;

export const PROPERTIES: Property[] = [
  { rule: "R1", statement: here("property-R1.lean").trim() },
  { rule: "R2", statement: here("property-R2.lean").trim() },
];

export interface LeanCase {
  rule: "R1" | "R2";
  formalization: string;
  body: string;
}

export const CASES = {
  "accept-R1": { rule: "R1", formalization: FORMALIZATION, body: here("proof-R1.lean") },
  "accept-R2": { rule: "R2", formalization: FORMALIZATION, body: here("proof-R2.lean") },
  placeholder: { rule: "R1", formalization: FORMALIZATION, body: here("proof-placeholder.lean") },
  "added-axiom": { rule: "R1", formalization: FORMALIZATION_WITH_AXIOM, body: here("proof-added-axiom.lean") },
  restated: { rule: "R1", formalization: FORMALIZATION, body: here("proof-restated.lean") },
  "changed-goal": { rule: "R1", formalization: FORMALIZATION, body: here("proof-changed-goal.lean") },
  /** The proof Lean accepts against the first Formalization, re-checked against the Refinement. */
  "after-refinement": { rule: "R1", formalization: REFINED, body: here("proof-R1.lean") },
  /** R1's statement against the Refinement, with a placeholder proof: does the Refinement compile? */
  "refined-statement": { rule: "R1", formalization: REFINED, body: "sorry" },
} satisfies Record<string, LeanCase>;

export type CaseName = keyof typeof CASES;

export const property = (rule: string): Property => PROPERTIES.find((p) => p.rule === rule)!;
