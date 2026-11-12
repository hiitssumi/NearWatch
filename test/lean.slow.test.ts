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

test("real Lean: the Formalization's statements compile, a statement that does not is caught, and the Prover's loop proves Rule 1", { skip }, async () => {
  const { formalize } = await import("../src/agents/agents.ts");
  const { prover } = await import("../src/agents/prover.ts");
  const answers = [
    JSON.stringify({ formalization: FORMALIZATION, properties: [PROPERTIES[0], { rule: "R2", statement: "∀ (s : State), s.balanc = s.balance" }] }),
    JSON.stringify({ formalization: FORMALIZATION, properties: PROPERTIES }),
    JSON.stringify({ proof: "intro s c a\nsimp" }),
    JSON.stringify({ proof: CASES["accept-R1"].body }),
  ];
  const prompts: string[] = [];
  const lines: string[] = [];
  const ctx = {
    llm: { ask: async (_a: string, prompt: string) => (prompts.push(prompt), { answer: answers.shift()!, tokens: { input: 1, output: 1 } }) },
    tokens: {},
    log: (l: string) => lines.push(l),
  };
  const rules = [
    { id: "R1", text: "Rule 1", check: { methods: ["withdraw"], slots: [], condition: { all: [] } } },
    { id: "R2", text: "Rule 2", check: { methods: ["set_paused"], slots: [], condition: { all: [] } } },
  ] as never;
  const f = await formalize(ctx as never, realToolchain(), "// source", { moneyMethods: [], balanceStorage: [], privilegedMethods: [], standingNote: "" }, rules);
  assert.ok(f, lines.join("\n"));
  assert.match(prompts[1]!, /Property for R2 \(stated as a theorem with a placeholder proof\)\. Lean's errors:\n[^\n]*error/);

  const result = await prover(ctx as never, realToolchain(), { formalization: f.formalization, properties: [f.properties[0]!] }, rules);
  assert.deepEqual(result.proofs.map((p) => p.rule), ["R1"]);
  // The line the prompt names for the proof body is the line Lean's errors point at.
  const bodyLine = Number(/starting on line (\d+)/.exec(prompts[2]!)![1]);
  // The failing attempt was "intro s c a" then "simp": the error is on the body's second line.
  assert.match(prompts[3]!, new RegExp(`property_R1\\.lean:${bodyLine + 1}:2: error: \`simp\` made no progress`));
});
