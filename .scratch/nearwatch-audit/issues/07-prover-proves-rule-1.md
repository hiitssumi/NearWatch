# 07: Prover proves Rule 1

**What to build:** In a live Audit, the Rules agent also writes the first Formalization and a Property for each Rule, and the Prover's own loop tries to prove each Property. The Referee re-checks whatever the Prover submits. A live Audit of the buggy vault shows Rule 1's Property proved against the first Formalization. This is the Lean checkpoint, due by Thursday night.

**Blocked by:** 04, 06

**Status:** resolved

- [x] The Rules agent returns a first Formalization that treats every contract call as one indivisible step, as `docs/adr/0001` requires, and a Property for each Rule.
- [x] The Formalization and Property statements must compile before the Prover starts. If they do not, the Rules agent is given Lean's errors and retries up to twice.
- [x] The Prover's loop is: write a proof body, check it, read Lean's errors, try again. It stops after twelve rounds or ten minutes per Property, whichever comes first.
- [x] The Prover supplies only the proof body.
- [x] Each attempt's tokens, dollars and time are logged against its Property and shown in the transcript.
- [x] The Referee re-checks every submitted proof itself.
- [x] A Property with no accepted proof within budget counts as having no proof.
- [x] A live Audit of the buggy vault shows Rule 1's Property proved by the loop itself against the first Formalization.
- [x] If that has not happened by Thursday night, the ticket stops and tells the builder. The proof is not written by hand. Ticket 18 then replaces this one.
- [x] The Recording of the successful run replays to the same verdicts in a fast test.

## Comments

**Done (13 Nov 2026, about 2:30 am, a few hours after the Thursday-night checkpoint; the builder chose to go ahead).** The checkpoint is met: in a live Audit of the buggy vault, the withdraw Rule's Property was proved by the Prover's own loop, in its first round, against the first Formalization. Ticket 18 is set to `wontfix`.

The live run (`recordings/live-prover-buggy-vault.json`, $0.73 in total, of which the Prover cost $0.09):
- The Rules agent numbered the spec's Rule 1 as **R2**: "A withdraw may reduce the caller's recorded balance only by the NEAR that actually reaches the account it names as receiver...". Its Property says that what the caller's record loses equals what the named receiver's `received` gains, for one withdraw step. Lean accepted the proof, with axioms propext, Classical.choice and Quot.sound.
- The Formalization is 59 lines. Withdraw is one step in which the transfer completes, as `docs/adr/0001` requires. It compiled on the first try.
- Verdicts: R1 Proven, R2 Proven, R3 Proven, R4 Broken, R5 Proven. The Prover proved all five Properties. R3's first answer was not JSON, and its second round succeeded.
- The Recording's commit is `4ff24a0...-dirty`. The only uncommitted change while it ran was a spec edit.

Two problems on the Attacker's side of this run. Neither is the Prover's, but both matter for ticket 08 (the Conflict needs a Finding on the same Rule):
1. **False Finding on R4.** R4 says only the owner may change the paused flag. Its Rule check is true whenever the flag changes, whoever signs, and S21 is the owner pausing honestly. The check language compares numbers only, so it cannot say "the signer is not the stored owner". The Referee correctly reproduced the check; the check itself is wrong. Ticket 08 or a ticket of its own needs either a way to compare the signer with an account view, or a Rules-prompt rule against checks that depend on who signs.
2. **The planted bug was not found this time.** On R2 the Attacker skipped bug class 1 with a wrong reason ("the balance deduction happens synchronously before the transfer", which is exactly the bug), and left classes 3 and 6 untried. Run 10 of ticket 05 found it as S5, so this is variance between runs. Ticket 08's live run needs both the Finding and the proof on the same Rule, in the same run.

What was built:
- `src/agents/agents.ts` `formalize`: the Rules agent's second answer, `{formalization, properties}`, with exactly one Property per Rule. Each statement is compiled against the Formalization with a placeholder proof (`sorry`). On failure, Lean's errors go back to the agent, up to twice. With nothing that compiles, the Prover is not asked.
- `src/agents/prover.ts`: the loop. It runs 12 rounds or 10 minutes per Property. The ten minutes are counted from the recorded duration of each LLM call and Lean check (`ms` on exchanges and Lean outcomes), so a replay stops where the live run did. Each round logs tokens, dollars and seconds. A body is screened (`screenProofBody`) before Lean, and the prompt names the file line the body starts on.
- `src/proof-rules.ts` `screenLeanText`: LLM-written Formalizations and statements may contain only plain definitions, because Lean runs code while it checks a file (`#eval` needs no imports). Proof bodies now also reject `set_option`.
- `src/audit.ts`: the order is Scout, Rules, Formalization, Attacker, Prover, Referee (sequential, so a Recording replays in order; ticket 08 asks for "side by side"). `AuditOptions.prover` is on in live Audits and stored in the Recording, so older Recordings without a Formalization still replay.
- `src/live-audit.ts`: uses the local Lean install (it fails before any LLM call if Lean is missing) and writes `formalization.lean`, `properties.json` and `proofs/property_<Rule>.lean` (the whole checked file, with the Referee's judgement on top).
- Tests: `test/prover.test.ts` has nine tests (eight from built Recordings, plus the live Recording's replay). `test/lean.slow.test.ts` gained a real-Lean run of the Formalization check and the Prover's loop.
