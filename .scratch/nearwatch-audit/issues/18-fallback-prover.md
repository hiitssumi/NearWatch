# 18: Fallback Prover

**What to build:** The replacement for ticket 07 if the Lean checkpoint is missed. Lean is dropped. The Rules agent writes the Formalization as a small executable state machine in TypeScript, and the Prover becomes a randomised tester that runs many sequences of steps against each Rule. A Rule that survives is labelled "checked, not proven". The Conflict still works, because the first Formalization still treats withdraw as one step. See the spec's section "If the Lean checkpoint is missed".

**Blocked by:** 04

**Status:** wontfix

This ticket waits on one fact: whether ticket 07 met the Lean checkpoint by Thursday night. If the builder declares the checkpoint missed, set this to `ready-for-agent`. If the checkpoint is met, set it to `wontfix`.

- [ ] The Rules agent writes the first Formalization as an executable state machine in which every contract call is one step, and each Rule as a check over a sequence of steps.
- [ ] The LLM-written Formalization runs with no access to files, the network or other processes.
- [ ] The Prover runs many random sequences of steps against each Rule. The random seed is recorded, so a run can be repeated exactly.
- [ ] A Rule that survives is labelled "checked, not proven" everywhere: transcript, verdicts, report and README. No Rule is ever called Proven.
- [ ] For Payouts, a checked Rule is treated as a Proven one would have been.
- [ ] A failing sequence is shown as a counterexample. It is not a Finding, since only the sandbox produces Findings.
- [ ] The Referee re-runs the tester itself, with the recorded seed, before accepting a "checked" result.
- [ ] A Conflict is a Finding against a Rule that is labelled checked. On a Conflict the Rules agent splits the one call the Finding went through, and the tester runs again.
- [ ] On the buggy vault, Rule 1 is checked against the first Formalization and fails against the Refinement.
- [ ] Lean is not called anywhere in an Audit. Ticket 17 is set to `wontfix`.
- [ ] Fast tests from Recordings cover: a checked Rule, a failing sequence, and the Referee rejecting a "checked" claim it cannot repeat.

## Comments

**wontfix (13 Nov 2026).** Ticket 07 met the Lean checkpoint: a live Audit of the buggy vault proved the withdraw Rule's Property with the Prover's own loop (`recordings/live-prover-buggy-vault.json`). Lean stays.
