# 08: Conflict and Refinement

**What to build:** The Attacker and the Prover run side by side, and the Referee catches them contradicting each other. A live Audit of the buggy vault shows the Conflict on Rule 1, one Refinement, the old proof failing against it, and the final verdicts: Rule 1 Broken, Rule 2 Proven. See the spec's section "Conflicts and Refinement".

**Blocked by:** 05, 07 (or 18, if it replaced 07)

**Status:** resolved

- [x] After the Rules agent, the Attacker and the Prover run side by side.
- [x] The Referee reports a Conflict when it has reproduced a Finding against a Rule and has also accepted a proof of that Rule's Property.
- [x] The transcript shows the Finding and the proof it contradicts side by side, with a short explanation. An LLM words the explanation and decides nothing.
- [x] On a Conflict the Rules agent receives the Finding and returns a Refinement that splits only the call the Finding went through, into a start step and a resolve step with a success branch and a failure branch.
- [x] The Referee re-checks the existing proof against the Refinement. If it no longer passes, the Conflict is resolved.
- [x] There are at most two Refinements. If the proof still passes after the second, it is withdrawn.
- [x] In every case the Rule ends Broken, because a Finding outranks a proof.
- [x] The Audit result lists, for each Rule, the Conflicts it went through.
- [x] Each Formalization and each re-check outcome is written to the Audit's folder.
- [x] A live Audit of the buggy vault shows one Conflict, one Refinement, Rule 1 Broken and Rule 2 Proven.
- [x] Fast test from a Recording: the path above.
- [x] Fast test: a proof that still passes after two Refinements is withdrawn and the Rule ends Broken.
- [x] Fast test: a Finding with no proof, or a proof with no Finding, raises no Conflict.
- [x] If ticket 18 replaced 07, "proof" here means a passing randomised check, and the labels follow ticket 18. (It did not: 18 is `wontfix`.)

## Comments

**Done (13 Nov 2026).** The live Audit of the buggy vault (`recordings/live-conflict-buggy-vault.json`, $1.70, about 37 minutes) shows the whole path:
- The Rules agent numbered the spec's Rule 1 (withdraw) as **R3** and the owner Rule as **R4** ("Only the stored owner may change the deposits-paused flag, and set_deposits_paused must never move the contract's NEAR or change anyone's recorded balance").
- The Attacker found the planted bug on R3 in round 1 (S8, class 1: withdraw 1 NEAR to `ghost`, which does not exist). The Prover proved all five Properties against the first Formalization, including R3's.
- **One Conflict, on R3.** The transcript shows the Finding (call, before and after, the failed receipt) and the proof (statement and body), then the explanation and the Payout moving from the Prover to the Attacker.
- **One Refinement** of withdraw (48 lines): `withdrawStart`, and a `resolve` step with success and failure branches. The Rules agent restated R3's Property over start-then-resolve, adding that after a failed transfer the caller's balance and the receiver's total are unchanged. The old proof no longer passes (`cases` fails on the new steps), so the Conflict is resolved.
- Verdicts: R1, R2, R4, R5 Proven; R3 Broken. **R4 has no false Finding** this time: the Rules prompt now tells the agent to test the signer, and the check language can say it.
- The Recording's commit is `0655720` with no `-dirty` mark. The run started before the progress-file change in that commit, but it read the commit at the end. That change does not affect what an Audit does.
- A fast test replays the Recording to the same verdicts and Conflict. The replayed transcript matches the live one exactly.

Honest notes:
- The old proof fails against the Refinement for a shallow reason: it names steps that no longer exist. That is what the ticket asks for ("no longer passes"). Real evidence that the Formalization was wrong is a counterexample to the restated Property, which is false for this Refinement because the failure branch restores nothing. That is ticket 17.
- **Cost and time.** The Rules agent spent $1.54 of the $1.70. Each Formalization call (two for the first Formalization, which failed to compile once, and one Refinement) produced 56,000 to 87,000 output tokens of hidden reasoning for a 3,000 to 4,000 character answer, taking 6 to 12 minutes. GLM's thinking could be turned off for the Rules agent through `requestExtras`, as it is for the Attacker, but that may hurt Lean that compiles. Worth trying before the demo recording (ticket 11).
- **Disclose in the README (ticket 12).** The Attacker's prompt now explains a general NEAR fact: a scheduled transfer runs later, so a method that changes state and schedules a transfer with no callback is a reason to try bug class 1, not to skip it. It does not describe this vault, but it is guidance.

What was built:
- **Side by side** (`src/audit.ts`). The Attacker runs at the same time as the Rules agent's Formalization followed by the Prover. Each side logs to its own buffer, printed in a fixed order, and spends from its own lane, half of what is left under the cap (`src/agents/ask.ts`). The replay gateway gives each agent its own exchanges in order; the replay toolchain keeps Scenario runs and Lean checks in separate orders (`src/replay/recording.ts`).
- **Conflicts** (`src/referee.ts`). `referee()` returns `conflicts`, meaning Rules with a reproduced Finding and an accepted proof. `explainConflict` asks the `referee` model to word the explanation, and `recheckProof` applies the same proof rules to a Refinement.
- **Refinements.** `refine()` in `src/agents/agents.ts` gives the Rules agent the Finding, the first Formalization, the Property, the accepted proof, and any earlier Refinement that the proof still passed. It shares the compile-and-retry loop with `formalize`. `settleConflict` in `src/audit.ts` runs up to `MAX_REFINEMENTS = 2` and records `resolved`, `withdrawn` or `unresolved`. `AuditResult.conflicts` lists each Conflict with its Refinements and re-checks. `AuditOptions.conflicts` is on in live Audits and stored in the Recording, so ticket 07's Recording still replays as it was made.
- **Folder.** `conflicts.json`, `refinements/<Rule>-refinement-<n>.lean`, and `refinements/<Rule>-refinement-<n>-recheck.lean` (the checked file with the outcome and Lean's errors on top).
- **Account comparison in Rule checks.** A Rule check can now use the expression `{"account":"$caller"}`, compared with `==` or `!=` against another account or a view returning one. It is validated in `src/schemas.ts` and evaluated in the Rust harness (`check.rs`, where references are resolved before the sandbox starts).
- **Progress file.** Live Audits write each line to `progress.txt` as it happens. Lines from the side-by-side part are tagged with their side.
- **Tests.**
  - `test/conflict.test.ts`: a proof withdrawn after two Refinements; no Conflict for a Finding without a proof or a proof without a Finding; an unresolved Conflict; the real Lean outcome of the hand-written Refinement; spend lanes; account comparisons; the live replay.
  - `test/live.test.ts`: now the scripted Conflict path, end to end.
  - `test/lean/vault-refined.lean`: a hand-written Refinement. Real Lean confirms it compiles and that the R1 proof fails against it.
  - `test/sandbox.slow.test.ts`: the owner pausing is not a break, but anyone else pausing is.
