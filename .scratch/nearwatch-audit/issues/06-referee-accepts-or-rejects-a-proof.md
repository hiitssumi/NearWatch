# 06: Referee accepts or rejects a proof

**What to build:** The toolchain's "check a Lean file" operation and the Referee's rules for proofs, exercised with Lean written by hand. No LLM is called in this ticket, so the rules are settled before any money is spent on the Prover. See the spec's section "Proofs".

**Blocked by:** 03

**Status:** resolved

Lean written by hand here is test material only. It never ships as an Audit's evidence.

- [x] The toolchain assembles the file Lean checks from three parts: the Formalization, the Property statement and the proof body.
- [x] It checks the file with the local Lean install and returns success, or the error text, plus the axioms the proof used.
- [x] Lean files are plain files with no Lean package dependencies. Mathlib is not used.
- [x] Test material exists: a first Formalization of the vault in which every call is one step, with the state described in the spec, and Property statements for Rule 1 and Rule 2.
- [x] The Referee accepts a complete proof, and the Rule ends Proven when no Finding stands against it.
- [x] A proof with a placeholder is rejected.
- [x] A proof that uses an axiom outside the standard set is rejected.
- [x] A proof body cannot change the statement being proved. An attempt to restate it is rejected or has no effect.
- [x] Lean's error text is returned unchanged, ready for the Prover's loop to read.
- [x] The replay toolchain returns stored Lean outcomes.
- [x] Fast tests from Recordings cover accept, placeholder, added axiom and changed statement.
- [x] A slow test with real Lean covers one accept and one reject.

## Comments

**Done (11 Nov 2026).** Run `npm test` (fast tests need only Node; the slow ones run when Lean is found, otherwise they skip) and `npm run typecheck`.

Installing Lean (no password needed, nothing system-wide):

    curl -sSfL https://raw.githubusercontent.com/leanprover/elan/master/elan-init.sh | sh -s -- -y --default-toolchain stable

This puts `lean` in `~/.elan/bin`. NearWatch finds Lean through `$NEARWATCH_LEAN`, then `PATH`, then `~/.elan/bin/lean`. It was developed against Lean 4.35.0. No Lean packages, no Mathlib. The slow tests are `test/lean.slow.test.ts`; `NEARWATCH_LEAN=/nonexistent npm test` shows them skipping.

Layout:
- `src/lean.ts`: `assembleLeanFile` (Formalization, then `theorem property_<Rule> :` with the Property statement, then `:= by` and the proof body indented, then a trailer the body never sees: `#print axioms` and a random marker line) and `LocalLean.checkLean`, which runs `lean` and returns `{ ok, errors, axioms }`. `errors` is Lean's own output, unchanged (file named `property_<Rule>.lean`, so line numbers refer to the assembled file). An axiom report only counts if the trailer's marker follows it, so a body that ends the file early or prints a fake report gets `ok: false`.
- `src/proof-rules.ts`: the Referee's rules. `screenProofBody` rejects before Lean: placeholders (`sorry`, `admit`, `sorryAx`), `#` commands, and declaration keywords (`theorem`, `axiom`, `def`, `end`, ...). `judgeLeanOutcome` rejects when Lean did not accept the file, on `sorryAx`, and on any axiom outside `propext`, `Classical.choice`, `Quot.sound`. Exported so the Prover's loop (ticket 07) can use the same screen.
- `src/referee.ts`: new optional last argument `{ formalization, properties, proofs }`; the result gains `proofs: ProofCheck[]`. Verdict: Broken if a Finding, else Proven if a proof was accepted, else Unproven.
- `src/ports.ts`: `Toolchain.checkLean(formalization, property, proofBody)`. `src/domain.ts`: `Property`, `Proof`, `LeanOutcome`, `ProofSubmission`, `ProofCheck`.
- `src/replay/recording.ts`: toolchain entries are now `{op:"runScenario",scenario,outcome}` or `{op:"checkLean",property,outcome:{ok,errors,axioms}}`, in one ordered list. Old Recordings still load.
- Test material (test-only, never evidence): `test/lean/` holds the first Formalization of the vault (one step per call), Property statements for Rules 1 and 2, real proofs of both, and bad proofs (placeholder, added axiom, restated theorem, changed goal). `npm run record-lean` re-checks them with real Lean into `test/lean/lean-outcomes.json`, which the fast tests replay; a slow test confirms the stored outcomes still match.

For ticket 07: `src/audit.ts` does not pass proofs to the Referee yet; the Rules agent's Formalization/Properties and the Prover's bodies should go in as the Referee's last argument. Note that with a coarse Formalization, Rule 1 really is provable (see `test/lean/proof-R1.lean`), as the spec's open risk hoped.
