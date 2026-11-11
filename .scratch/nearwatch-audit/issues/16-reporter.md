# 16: Reporter

**What to build:** At the end of an Audit the Reporter writes a plain-English report for the contract's owner into the Audit's folder. Should-have. This is the third ticket dropped if time runs out.

**Blocked by:** 08

**Status:** ready-for-agent

- [ ] The Reporter is one LLM call with a fixed prompt, built from the Referee's result. It adds no claims of its own.
- [ ] The report gives each Rule's verdict in plain English.
- [ ] For a Broken Rule it describes the Finding and says how to re-run its Scenario.
- [ ] It lists the Conflicts each Rule went through.
- [ ] It says that a proof covers the Formalization and not the contract's code.
- [ ] It lists Leads separately from Findings.
- [ ] It gives the cost of the Audit and of each proof attempt.
- [ ] The report is written into the Audit's folder, and the transcript says where.
- [ ] The Reporter's exchange is recorded, and replay produces the same report.
- [ ] If the Reporter's answer is still invalid after its retries, the Audit completes without a report and its share returns to the payer.
