# 08: Conflict and Refinement

**What to build:** The Attacker and the Prover run side by side, and the Referee catches them contradicting each other. A live Audit of the buggy vault shows the Conflict on Rule 1, one Refinement, the old proof failing against it, and the final verdicts: Rule 1 Broken, Rule 2 Proven. See the spec's section "Conflicts and Refinement".

**Blocked by:** 05, 07 (or 18, if it replaced 07)

**Status:** ready-for-agent

- [ ] After the Rules agent, the Attacker and the Prover run side by side.
- [ ] The Referee reports a Conflict when it has reproduced a Finding against a Rule and has also accepted a proof of that Rule's Property.
- [ ] The transcript shows the Finding and the proof it contradicts side by side, with a short explanation. An LLM words the explanation and decides nothing.
- [ ] On a Conflict the Rules agent receives the Finding and returns a Refinement that splits only the call the Finding went through, into a start step and a resolve step with a success branch and a failure branch.
- [ ] The Referee re-checks the existing proof against the Refinement. If it no longer passes, the Conflict is resolved.
- [ ] There are at most two Refinements. If the proof still passes after the second, it is withdrawn.
- [ ] In every case the Rule ends Broken, because a Finding outranks a proof.
- [ ] The Audit result lists, for each Rule, the Conflicts it went through.
- [ ] Each Formalization and each re-check outcome is written to the Audit's folder.
- [ ] A live Audit of the buggy vault shows one Conflict, one Refinement, Rule 1 Broken and Rule 2 Proven.
- [ ] Fast test from a Recording: the path above.
- [ ] Fast test: a proof that still passes after two Refinements is withdrawn and the Rule ends Broken.
- [ ] Fast test: a Finding with no proof, or a proof with no Finding, raises no Conflict.
- [ ] If ticket 18 replaced 07, "proof" here means a passing randomised check, and the labels follow ticket 18.
