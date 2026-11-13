# 11: Ship the demo Recording

**What to build:** One full, checked Recording of a live Audit of the buggy vault ships in the repository, and the replay command plays it by default. Someone with a fresh clone and only Node installed sees the whole Audit with no keys and no network. This is Friday's milestone. No new features are added after it.

**Blocked by:** 10

**Status:** ready-for-agent

Needs from the builder: to read the Recording and approve it before it ships.

- [ ] The Recording comes from one real live Audit of the buggy vault, made with the recording models from the brief: the Attacker on NEAR AI's uncensored DeepSeek model, the Prover on Claude Opus, the others on GLM 5.3.
- [ ] The Recording holds, in order: every LLM exchange with its agent and token use, every toolchain outcome, every Payout hash, the settings used, and the commit it was made from.
- [ ] The Recording contains no key or other secret. This is checked before it is committed.
- [ ] The builder has read the Recording and approved it.
- [ ] The replay command plays this Recording when given no other.
- [ ] Plain replay prints the full transcript: the money map, the Rules, the Finding, the proof, the Conflict, the Refinement, the verdicts, the Payouts with their hashes, and the total spend.
- [ ] In replay the Referee and the Payout calculation run for real on the recorded evidence.
- [ ] Fast test: the shipped Recording ends with Rule 1 Broken, Rule 2 Proven, one Conflict, one Refinement, and Rule 1's share paid to the Attacker.
- [ ] From a fresh clone on a machine with only Node, installing and replaying works with no keys and no network. This has been tried on a clean checkout.

## Comments

14 Nov 2026, before this ticket: tried lowering the Rules agent's reasoning to cut the cost of the demo run. Decided with the builder to keep **full reasoning** for the demo Recording.
- On NEAR AI, GLM-5.3 ignores `thinking: {type: "disabled"}`, and `chat_template_kwargs.enable_thinking: false` moves its reasoning into the answer text. Only `reasoning_effort: "low"` works (about 6 reasoning tokens, a normal answer).
- `requestExtras` can now be keyed by agent name as well as model id, so the Rules agent can be set alone (it shares GLM with the Scout, Referee and Reporter).
- One live Audit of the buggy vault with `"rules": {"reasoning_effort": "low"}` (`audits/rules-low-1`, not shipped): the Rules agent cost $0.16 and 2.4 minutes, against $1.54 and 35 minutes in ticket 08, and the whole Audit $0.73 against $1.70. But the Formalization compiled only on its third and last attempt, and the withdraw Property was false against it: the model subtracts the amount from the vault's NEAR with nothing saying the vault holds at least the recorded balances (Lean confirms a counterexample with a vault of 0). The Prover spent its 12 rounds on a Property with no proof, so there was a Finding and no Conflict.
- One run only. Low reasoning is still useful for cheap rehearsals of everything except the Conflict.
