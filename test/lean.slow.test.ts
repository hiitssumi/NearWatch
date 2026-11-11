// Slow: the proof rules against the real local Lean install. Skips when Lean is missing.
// Install: elan (https://github.com/leanprover/elan), then `elan default stable`. No packages, no Mathlib.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { LeanOutcome } from "../src/domain.ts";
import { findLean, LocalLean } from "../src/lean.ts";
import type { Toolchain } from "../src/ports.ts";
import { referee } from "../src/referee.ts";
import { CASES, type CaseName, FORMALIZATION, FORMALIZATION_WITH_AXIOM, PROPERTIES, property } from "./lean/cases.ts";

const skip = findLean() ? false : "Lean is not installed (see test/lean.slow.test.ts)";

function realToolchain(): Toolchain {
  const lean = new LocalLean();
  return {
    runScenario: () => Promise.reject(new Error("no Scenarios in this test")),
    checkLean: (f, p, b) => lean.checkLean(f, p, b),
  };
}

const rules = [
  { id: "R1", text: "Rule 1", check: { slots: [], condition: { all: [] } } },
  { id: "R2", text: "Rule 2", check: { slots: [], condition: { all: [] } } },
] as never;

test("real Lean: the Referee accepts a complete proof of Rule 1 and Rule 1 ends Proven", { skip }, async () => {
  const result = await referee("vault", rules, [], realToolchain(), () => {}, {
    formalization: FORMALIZATION,
    properties: PROPERTIES,
    proofs: [{ rule: "R1", body: CASES["accept-R1"].body }],
  });
  assert.equal(result.proofs[0]!.accepted, true, result.proofs[0]!.outcome?.errors);
  assert.deepEqual(result.verdicts, { R1: "Proven", R2: "Unproven" });
});

test("real Lean: the Referee rejects a proof that relies on an added axiom", { skip }, async () => {
  const result = await referee("vault", rules, [], realToolchain(), () => {}, {
    formalization: FORMALIZATION_WITH_AXIOM,
    properties: PROPERTIES,
    proofs: [{ rule: "R1", body: CASES["added-axiom"].body }],
  });
  assert.equal(result.proofs[0]!.accepted, false);
  assert.match(result.proofs[0]!.reason, /vault_cheat/);
  assert.equal(result.verdicts.R1, "Unproven");
});

test("real Lean: every stored outcome the fast tests replay still matches", { skip }, async () => {
  const stored: Record<CaseName, LeanOutcome> = JSON.parse(
    readFileSync(new URL("./lean/lean-outcomes.json", import.meta.url), "utf8"),
  ).outcomes;
  const lean = new LocalLean();
  for (const [name, c] of Object.entries(CASES) as [CaseName, (typeof CASES)[CaseName]][]) {
    const real = await lean.checkLean(c.formalization, property(c.rule), c.body);
    assert.deepEqual(real, stored[name], `case ${name} (re-record with npm run record-lean if Lean changed)`);
  }
});
