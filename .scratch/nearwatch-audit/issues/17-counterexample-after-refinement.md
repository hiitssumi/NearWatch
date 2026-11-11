# 17: Counterexample after Refinement

**What to build:** After a Refinement, the Prover goes one step further than "the old proof no longer passes". It produces a counterexample: a concrete sequence of steps, checked by Lean, that breaks the Property against the refined Formalization. When that sequence follows the same path as the Finding, the Attacker and the Prover agree on why the Rule is broken. Should-have. Does not apply if ticket 18 replaced 07.

**Blocked by:** 08

**Status:** ready-for-agent

- [ ] After a Refinement the Prover may first try to prove the Property against it, and failing that, give a counterexample.
- [ ] A counterexample is a concrete sequence of steps that Lean confirms breaks the Property.
- [ ] The Referee re-checks the counterexample with Lean itself.
- [ ] The transcript shows the counterexample beside the Finding and says whether they follow the same path.
- [ ] This uses the same round and time limits as a proof attempt, and its cost is logged.
- [ ] If no counterexample is found within budget, the Audit's result is unchanged.
- [ ] Fast test from a Recording that contains a counterexample.
- [ ] A slow test with real Lean checks one counterexample.
