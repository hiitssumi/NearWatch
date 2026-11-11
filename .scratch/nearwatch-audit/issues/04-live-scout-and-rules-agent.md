# 04: Live Scout and Rules agent

**What to build:** A live audit command that runs the Scout and the Rules agent on a contract through NEAR AI Cloud, prints the money map and the Rules, records itself so the run can be replayed, tracks what it spends, and stops at the spend cap.

**Blocked by:** 03

**Status:** ready-for-agent

Needs from the builder: a NEAR AI key in the local settings file.

- [ ] An audit command takes a path to a contract.
- [ ] A contract that is not Rust with near-sdk is refused with a clear message before any LLM call.
- [ ] The live LLM gateway calls NEAR AI Cloud through its OpenAI-compatible interface.
- [ ] The recording gateway wraps the live one and stores every exchange with its agent and token use.
- [ ] Settings come from a local file that is never committed: the key, the model for each agent, and the spend cap. The repository has an example file with names only, and the real file is ignored by git.
- [ ] The Scout returns: the methods that move money, where balances are recorded, the privileged methods and who may call them, and a standing note that key and upgrade control must be checked on the deployed account.
- [ ] The Rules agent returns, for each Rule, its plain-English text and a Rule check.
- [ ] An invalid answer is retried up to twice, then treated as that agent producing nothing.
- [ ] Each call is priced from a table in settings, and the transcript shows total spend.
- [ ] At the spend cap (default $5) the Audit stops calling LLMs and finishes with what it has.
- [ ] The Recording made by a live run replays through ticket 03's command to the same result.
- [ ] Fast tests from Recordings cover the retry rule and the spend cap.
- [ ] Each model chosen in settings has answered at least one call. The catalog's readiness flag is not understood, so this is checked by calling.
