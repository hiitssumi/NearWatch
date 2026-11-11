# 07: Prover proves Rule 1

**What to build:** In a live Audit, the Rules agent also writes the first Formalization and a Property for each Rule, and the Prover's own loop tries to prove each Property. The Referee re-checks whatever the Prover submits. A live Audit of the buggy vault shows Rule 1's Property proved against the first Formalization. This is the Lean checkpoint, due by Thursday night.

**Blocked by:** 04, 06

**Status:** ready-for-agent

- [ ] The Rules agent returns a first Formalization that treats every contract call as one indivisible step, as `docs/adr/0001` requires, and a Property for each Rule.
- [ ] The Formalization and Property statements must compile before the Prover starts. If they do not, the Rules agent is given Lean's errors and retries up to twice.
- [ ] The Prover's loop is: write a proof body, check it, read Lean's errors, try again. It stops after twelve rounds or ten minutes per Property, whichever comes first.
- [ ] The Prover supplies only the proof body.
- [ ] Each attempt's tokens, dollars and time are logged against its Property and shown in the transcript.
- [ ] The Referee re-checks every submitted proof itself.
- [ ] A Property with no accepted proof within budget counts as having no proof.
- [ ] A live Audit of the buggy vault shows Rule 1's Property proved by the loop itself against the first Formalization.
- [ ] If that has not happened by Thursday night, the ticket stops and tells the builder. The proof is not written by hand. Ticket 18 then replaces this one.
- [ ] The Recording of the successful run replays to the same verdicts in a fast test.
