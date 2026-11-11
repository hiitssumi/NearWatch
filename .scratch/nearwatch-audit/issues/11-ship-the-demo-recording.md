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
