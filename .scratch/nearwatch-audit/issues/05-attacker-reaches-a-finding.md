# 05: Attacker reaches a Finding

**What to build:** The live Attacker proposes Scenarios against each Rule, the harness runs them, and the Referee re-runs any Scenario that claims to break a Rule before calling it a Finding. A live Audit of the buggy vault ends with Rule 1 Broken. This is Thursday's milestone.

**Blocked by:** 02, 04

**Status:** ready-for-agent

- [ ] The Attacker's inputs are the contract source, the Scout's map, the Rules, the list of sandbox actions, and the bug-class list. Nothing else. The Recording shows these inputs.
- [ ] The bug-class list holds the seven classes named in the spec.
- [ ] For each Rule the Attacker tries each bug class, with up to three Scenario attempts per pair, and stops at the first Finding for that Rule.
- [ ] After a failed attempt the Attacker sees what the harness observed and can adjust.
- [ ] The Referee re-runs each claimed Scenario through the toolchain itself. It is a Finding only if the Referee's own run makes the Rule check true.
- [ ] Every other Scenario is listed as a Lead.
- [ ] A live Audit of the buggy vault ends with Rule 1 Broken, without the Attacker being told where the bug is.
- [ ] If the Attacker cannot do that within its budget, the ticket stops and reports what was tried. No hint beyond the bug-class list is added.
- [ ] Each Scenario is written to the Audit's folder in a form that can be re-run.
- [ ] The Recording of this run replays to the same verdicts in a fast test.
- [ ] The Attacker uses the model named in settings, which defaults to NEAR AI's uncensored DeepSeek model.
