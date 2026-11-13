# 16: Reporter

**What to build:** At the end of an Audit the Reporter writes a plain-English report for the contract's owner into the Audit's folder. Should-have. This is the third ticket dropped if time runs out.

**Blocked by:** 08

**Status:** resolved

- [x] The Reporter is one LLM call with a fixed prompt, built from the Referee's result. It adds no claims of its own.
- [x] The report gives each Rule's verdict in plain English.
- [x] For a Broken Rule it describes the Finding and says how to re-run its Scenario.
- [x] It lists the Conflicts each Rule went through.
- [x] It says that a proof covers the Formalization and not the contract's code.
- [x] It lists Leads separately from Findings.
- [x] It gives the cost of the Audit and of each proof attempt.
- [x] The report is written into the Audit's folder, and the transcript says where.
- [x] The Reporter's exchange is recorded, and replay produces the same report.
- [x] If the Reporter's answer is still invalid after its retries, the Audit completes without a report and its share returns to the payer.

## Comments

**Done (14 Nov 2026).** The live run continues ticket 17's buggy-vault Recording (`recordings/live-report-buggy-vault.json`). Everything up to the verdicts was replayed: 25 exchanges, every prompt identical, and 48 toolchain outcomes. Only the Reporter was live, at $0.0499 (GLM-5.3, one call, 8,248 output tokens, mostly hidden reasoning). The 155-line report in `audits/t16-buggy-1/report.md` covers:
- the verdicts (R3 withdraw Broken, the other four Proven) with a plain-English passage for each;
- Finding S8 (alice withdraws 1 NEAR to `ghost`, the transfer fails, her record drops from 2 to 1) and the command that re-runs it;
- the Conflict, resolved, with the counterexample following the Finding's path;
- what a proof covers;
- 54 Leads, listed after the Findings;
- the cost: $1.79 in all, by agent and for each of the six proof attempts.

Replaying the Recording gives the identical report and transcript. The Recording's commit is `e619645-dirty` (ticket 16's code before it was committed).

Honest notes:
- **The design keeps the LLM away from facts.** It words only the summary and the passages. Code writes the verdicts, calls, observations, re-run commands, Conflict outcomes, Leads and costs. The answer is checked against the Referee's result: exactly the Rules, Findings and Conflicts there are, and no verdict word other than the Rule's own. This cannot stop an LLM paraphrasing loosely. In this run the Conflict passage says "Lean confirmed the same path as the Finding", but Lean confirmed the counterexample and an LLM made the path comparison. The code-written line under it says so correctly. Nothing beyond the facts given appears: no fixes, no severity.
- **The Audit's folder is named in the report's re-run commands.** It is stored in the Recording (`folder`), so a replay writes the same report. A Recording's report therefore names the folder of the run that made it.
- The fixed vault's Recording (ticket 14) has no Reporter exchange, so it replays with no report, as do all older Recordings (`AuditOptions.reporter`, stored in the Recording).

What was built:
- `src/agents/reporter.ts`: `reporter()` (the prompt and the checked answer) and `renderReport()` (the Markdown).
- **Proof attempts.** The Prover's rounds now return their count, cost and time. `AuditResult.proofAttempts` has one entry per Property, plus the Prover's turn after a Refinement.
- `src/audit.ts`: after the verdicts, "== Reporter ==". The report is rendered after the call, so its costs include the report. If the Reporter gives no valid answer, it is not counted as having run, and its share returns to the payer. `AuditResult.report`.
- `src/live-audit.ts`: the Reporter is on, the folder is passed in, and `report.md` is written.
- **Tests.**
  - `test/reporter.test.ts`: the report's parts from the fixed vault's Recording, and a replay gives the same report; a wrong verdict, a missing Rule and invalid JSON leave no report, with the share returned to the payer; an older Recording asks the Reporter nothing; the live Recording replays.
  - `test/live.test.ts`: the scripted end-to-end run now ends with the Reporter (retried once) and checks `report.md`.
