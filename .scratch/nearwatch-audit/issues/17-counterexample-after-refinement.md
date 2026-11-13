# 17: Counterexample after Refinement

**What to build:** After a Refinement, the Prover goes one step further than "the old proof no longer passes". It produces a counterexample: a concrete sequence of steps, checked by Lean, that breaks the Property against the refined Formalization. When that sequence follows the same path as the Finding, the Attacker and the Prover agree on why the Rule is broken. Should-have. Does not apply if ticket 18 replaced 07.

**Blocked by:** 08

**Status:** resolved

- [x] After a Refinement the Prover may first try to prove the Property against it, and failing that, give a counterexample.
- [x] A counterexample is a concrete sequence of steps that Lean confirms breaks the Property.
- [x] The Referee re-checks the counterexample with Lean itself.
- [x] The transcript shows the counterexample beside the Finding and says whether they follow the same path.
- [x] This uses the same round and time limits as a proof attempt, and its cost is logged.
- [x] If no counterexample is found within budget, the Audit's result is unchanged.
- [x] Fast test from a Recording that contains a counterexample.
- [x] A slow test with real Lean checks one counterexample.

## Comments

**Done (13 Nov 2026).** The live run continues ticket 08's (`recordings/live-counterexample-buggy-vault.json`). Everything up to the Refinement is ticket 08's Recording, replayed: 23 exchanges, every prompt identical to the stored one, and 46 toolchain outcomes. Only the new step was live: one Prover call and one comparison, about $0.04 (total for the whole Audit $1.74).
- The Prover answered on round 1 with a counterexample to the restated R3 (withdraw): alice holds 2 and withdraws 1 to `ghost`, `withdrawStart` deducts it, the transfer fails (`resolve false`), and her balance is never re-credited, so 1 left her and 0 arrived. Lean confirmed it, and the Referee re-checked it with Lean (axioms propext, Quot.sound). Running real Lean on the written file `refinements/R3-refinement-1-counterexample.lean` confirms it again.
- Beside the Finding S8 (withdraw 1 NEAR to `ghost`, failed receipt), the comparison says **same path**: a withdraw to a missing account whose transfer fails, leaving the caller's balance deducted. The transcript ends the Conflict with "The Attacker and the Prover agree on why R3 is broken."
- Verdicts and Payouts are exactly ticket 08's.
- The Recording's commit is `418a1b3-dirty`: the run used ticket 17's code before it was committed.

Honest notes:
- **The same-path comparison is made by an LLM** (the Referee's wording model), labelled as such, and decides nothing. Deciding it in code would need to know which step of an arbitrary Refinement is the transfer and which branch a counterexample took. In this run either value of `ok` would have broken the restated Property, because part of it hard-codes `resolve false`. What Lean does establish is that the counterexample is real.
- **Continuing a Recording** (`npm run audit -- <contract> --continue-from <recording>`) is new and says so in the Recording's settings (`continuedFrom`, with replayed and live counts). It saved re-running the $1.70, 37-minute Formalization. The demo Recording for ticket 11 should still be one fresh live run.
- The counterexample's values are concrete because the toolchain applies the Property to them in the file it assembles. The Prover writes only the values and the tactics after `have hw := ...`.

What was built:
- **The Prover after a Refinement** (`proveOrRefute` in `src/agents/prover.ts`). It shares one rounds loop with the proof loop (the same 12 rounds, 10 minutes and spend cap), and answers either `{"proof"}` or `{"counterexample":{"witnesses","proof","path"}}`. Its prompt shows the Finding, the refined file, both theorem shapes and earlier failed attempts.
- **Assembly** (`src/lean.ts`). `negatedProperty` gives `¬ (statement)` under the theorem name `property_<R>_counterexample`. `counterexampleBody` gives `intro h`, then `have hw := h (v1) (v2) ...`, then the tactics. Both go through the existing `checkLean`, so Recording and replay needed no new toolchain operation.
- **Referee** (`src/referee.ts`). `checkCounterexample` screens each value and the tactics, then applies the proof rules with Lean. `comparePaths` has an LLM compare the paths.
- **Audit** (`src/audit.ts`). After the Refinement that resolves a Conflict, it runs the Prover's turn, the Referee's re-check, the counterexample beside the Finding, and the step's cost. `Conflict.afterRefinement` records the counterexample or proof. `AuditOptions.counterexamples` is on in live Audits and stored in Recordings, so older Recordings replay unchanged. The restated Property is now logged one line per transcript line.
- **Folder.** `refinements/<R>-refinement-<n>-counterexample.lean` (or `-proof.lean`): the checked file with the outcome, the Prover's path and the comparison on top.
- **Glossary**: Counterexample. **Spec**: Conflicts and Refinement, the Referee, and Recording and replay (continuing).
- **Tests.**
  - `test/conflict.test.ts`: the counterexample path, from a Recording built on the hand-written Refinement with R1 restated over start-then-resolve; no counterexample within 12 rounds leaves the result unchanged; a proof of the restated Property instead changes nothing; the live Recording replays.
  - `test/live.test.ts`: the scripted end-to-end run now includes the counterexample and its file, and a cut-off Recording is continued with only the new step asked live, then replays on its own.
  - `test/lean.slow.test.ts`: real Lean confirms the hand-written counterexample on the failure branch, rejects the same values on the success branch, and a non-concrete value is refused before Lean.
  - `test/lean/cases.ts`: the restated R1 and four new Lean cases, re-recorded.
