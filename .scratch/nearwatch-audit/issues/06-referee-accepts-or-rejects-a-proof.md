# 06: Referee accepts or rejects a proof

**What to build:** The toolchain's "check a Lean file" operation and the Referee's rules for proofs, exercised with Lean written by hand. No LLM is called in this ticket, so the rules are settled before any money is spent on the Prover. See the spec's section "Proofs".

**Blocked by:** 03

**Status:** ready-for-agent

Lean written by hand here is test material only. It never ships as an Audit's evidence.

- [ ] The toolchain assembles the file Lean checks from three parts: the Formalization, the Property statement and the proof body.
- [ ] It checks the file with the local Lean install and returns success, or the error text, plus the axioms the proof used.
- [ ] Lean files are plain files with no Lean package dependencies. Mathlib is not used.
- [ ] Test material exists: a first Formalization of the vault in which every call is one step, with the state described in the spec, and Property statements for Rule 1 and Rule 2.
- [ ] The Referee accepts a complete proof, and the Rule ends Proven when no Finding stands against it.
- [ ] A proof with a placeholder is rejected.
- [ ] A proof that uses an axiom outside the standard set is rejected.
- [ ] A proof body cannot change the statement being proved. An attempt to restate it is rejected or has no effect.
- [ ] Lean's error text is returned unchanged, ready for the Prover's loop to read.
- [ ] The replay toolchain returns stored Lean outcomes.
- [ ] Fast tests from Recordings cover accept, placeholder, added axiom and changed statement.
- [ ] A slow test with real Lean covers one accept and one reject.
