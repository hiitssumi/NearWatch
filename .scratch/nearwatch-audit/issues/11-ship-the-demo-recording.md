# 11: Ship the demo Recording

**What to build:** One full, checked Recording of a live Audit of the buggy vault ships in the repository, and the replay command plays it by default. Someone with a fresh clone and only Node installed sees the whole Audit with no keys and no network. This is Friday's milestone. No new features are added after it.

**Blocked by:** 10

**Status:** resolved

Needs from the builder: to read the Recording and approve it before it ships.

- [x] The Recording comes from one real live Audit of the buggy vault, made with the recording models from the brief: the Attacker on NEAR AI's uncensored DeepSeek model, the Prover on Claude Opus, the others on GLM 5.3.
- [x] The Recording holds, in order: every LLM exchange with its agent and token use, every toolchain outcome, every Payout hash, the settings used, and the commit it was made from.
- [x] The Recording contains no key or other secret. This is checked before it is committed.
- [x] The builder has read the Recording and approved it.
- [x] The replay command plays this Recording when given no other.
- [x] Plain replay prints the full transcript: the money map, the Rules, the Finding, the proof, the Conflict, the Refinement, the verdicts, the Payouts with their hashes, and the total spend.
- [x] In replay the Referee and the Payout calculation run for real on the recorded evidence.
- [x] Fast test: the shipped Recording ends with Rule 1 Broken, Rule 2 Proven, one Conflict, one Refinement, and Rule 1's share paid to the Attacker.
- [x] From a fresh clone on a machine with only Node, installing and replaying works with no keys and no network. This has been tried on a clean checkout.

## Comments

14 Nov 2026, before this ticket: tried lowering the Rules agent's reasoning to cut the cost of the demo run. Decided with the builder to keep **full reasoning** for the demo Recording.
- On NEAR AI, GLM-5.3 ignores `thinking: {type: "disabled"}`, and `chat_template_kwargs.enable_thinking: false` moves its reasoning into the answer text. Only `reasoning_effort: "low"` works (about 6 reasoning tokens, a normal answer).
- `requestExtras` can now be keyed by agent name as well as model id, so the Rules agent can be set alone (it shares GLM with the Scout, Referee and Reporter).
- One live Audit of the buggy vault with `"rules": {"reasoning_effort": "low"}` (`audits/rules-low-1`, not shipped): the Rules agent cost $0.16 and 2.4 minutes, against $1.54 and 35 minutes in ticket 08, and the whole Audit $0.73 against $1.70. But the Formalization compiled only on its third and last attempt, and the withdraw Property was false against it: the model subtracts the amount from the vault's NEAR with nothing saying the vault holds at least the recorded balances (Lean confirms a counterexample with a vault of 0). The Prover spent its 12 rounds on a Property with no proof, so there was a Finding and no Conflict.
- One run only. Low reasoning is still useful for cheap rehearsals of everything except the Conflict.

**Built (14 Nov 2026); waiting for the builder to read and approve the Recording.** `recordings/demo-buggy-vault.json` is one full live Audit of the buggy vault from the clean commit `f4faff1`, with the brief's models, nothing replayed, and its payments made on NEAR testnet.
- **The path.** The Rules agent numbered withdraw R2 and the owner's pause R3. The Attacker's S4 (alice withdraws 1 NEAR to `ghost`, the transfer fails, her ledger drops from 1 to 0) is a Finding against R2. The Prover proved all five Properties against the first Formalization. That gives a **Conflict on R2**, then Refinement 1 (75 lines) with R2 restated; the old proof no longer passes, so the Conflict is resolved. The Prover's counterexample to the restated R2 holds in Lean, and the comparison says it follows the Finding's path.
- **Verdicts:** R2 Broken; R1, R3, R4, R5 Proven. The Reporter wrote a 153-line report.
- **Payments.** The Fee and nine Payouts are on testnet; R2's share went to the Attacker (`GvHZ9QoWvWjkJPctWg18HSiiyY8s2GeVmEhrzwmCXvkk`). Asking the RPC for each of the 10 hashes returns a final, successful transfer with the recorded sender, receiver and amount.
- **Cost:** $0.97 of LLM calls (the Rules agent $0.75), 16 minutes of LLM time.
- **No secret.** Neither key is in the Recording, the Audit's folder or the log, and the Recording has no key fields.
- **Default replay.** `npm run replay` plays it. `test/demo.test.ts` checks the models, the clean commit, the verdicts, the one Conflict and Refinement, the Attacker's Payout and hash, and what the command prints.
- **Fresh clone.** A clone of `main` at `f4faff1`, with the Recording and the new default added, had no `settings.local.json` and no Rust build. `npm install` and then `npm run replay`, with every network call made to fail, printed the same 220-line transcript as the working copy and made no network call.

Getting here:
- **The first demo run failed** (`audits/demo-1`, not shipped): NEAR AI's DeepSeek model (the Attacker's) answered "unavailable", and two quick retries were not enough. Its 1 NEAR Fee was collected and no Payouts were sent; that NEAR is still in the parent account. Two fixes followed in `f4faff1`: a busy model is retried with exponential waits for about 6.5 minutes, and when one side of the side-by-side part fails, the other stops too (the Prover had gone on spending after the failure).
- DeepSeek stayed unavailable for about 50 minutes (02:15 to 03:06). The demo run started when it answered again.

Notes for the builder:
- **The report's re-run commands name `audits/demo-2/scenarios/S4.json`**, a folder that is gitignored and so not in the repository. Re-running S4 from a fresh clone needs that file. Shipping `audits/demo-2/scenarios/` in the repository would fix this.
- The spec says Rule 1 and Rule 2; this run numbers them R2 and R3. The fast test checks them by their text.

**Approved by the builder (14 Nov 2026)** and committed. The S4 Scenario file is not shipped; the report's re-run command still names the gitignored `audits/demo-2` folder.
