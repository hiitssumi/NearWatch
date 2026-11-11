# 04: Live Scout and Rules agent

**What to build:** A live audit command that runs the Scout and the Rules agent on a contract through NEAR AI Cloud, prints the money map and the Rules, records itself so the run can be replayed, tracks what it spends, and stops at the spend cap.

**Blocked by:** 03

**Status:** resolved

Needs from the builder: a NEAR AI key in the local settings file.

- [x] An audit command takes a path to a contract.
- [x] A contract that is not Rust with near-sdk is refused with a clear message before any LLM call.
- [x] The live LLM gateway calls NEAR AI Cloud through its OpenAI-compatible interface.
- [x] The recording gateway wraps the live one and stores every exchange with its agent and token use.
- [x] Settings come from a local file that is never committed: the key, the model for each agent, and the spend cap. The repository has an example file with names only, and the real file is ignored by git.
- [x] The Scout returns: the methods that move money, where balances are recorded, the privileged methods and who may call them, and a standing note that key and upgrade control must be checked on the deployed account.
- [x] The Rules agent returns, for each Rule, its plain-English text and a Rule check.
- [x] An invalid answer is retried up to twice, then treated as that agent producing nothing.
- [x] Each call is priced from a table in settings, and the transcript shows total spend.
- [x] At the spend cap (default $5) the Audit stops calling LLMs and finishes with what it has.
- [x] The Recording made by a live run replays through ticket 03's command to the same result.
- [x] Fast tests from Recordings cover the retry rule and the spend cap.
- [x] Each model chosen in settings has answered at least one call. The catalog's readiness flag is not understood, so this is checked by calling.

## Comments

**Done (12 Nov 2026).** Branch `claude/ticket-04-live-scout-rules-406fc5`.

Run:
- `npm run audit -- <contract .rs file or near-sdk crate folder>` writes `audits/<time>/` (`recording.json`, `scout-map.json`, `rules.json`, `transcript.txt`). Replay it with `npm run replay -- audits/<time>/recording.json`.
- `npm run check-models` calls each model in settings once.
- Settings: copy `settings.example.json` to `settings.local.json` (git-ignored) and fill in `nearAiKey`.

Layout:
- `src/settings.ts`: loader and checks, `priceCall`, `publicSettings` (strips the keys before anything goes into a Recording).
- `src/llm/live.ts`: `LiveGateway` (fetch, `POST {baseUrl}/chat/completions`, retries 429/5xx twice, prices each call).
- `src/llm/recording.ts`: `RecordingGateway`, `currentCommit`.
- `src/contract.ts`: `readContract` refuses anything that is not a near-sdk `.rs` file or crate. It runs before settings are read, so a refusal needs no key.
- `src/live-audit.ts`: wires the pieces; `src/cli/audit.ts`, `src/cli/check-models.ts`.

Decisions later tickets should know:
- `LlmAnswer` has optional `usd` and `model`. Recording exchanges have optional `model`, `prompt` and `usd`, so replay reproduces spend and the cap exactly. Hand-made Recordings without `usd` spend $0.
- The spend cap lives in `askStructured` (`src/agents/ask.ts`): before every call, including retries, it checks `ctx.budget`. At the cap the agent produces nothing and the Audit continues. Any new agent that calls `ctx.llm` directly instead of `askStructured` must call `mayCall`/`charge` itself.
- `runAudit(path, ports, options)` takes optional `{ spendCapUsd, stopAfter: "rules" }`. The live command passes `stopAfter: "rules"` because there is no sandbox toolchain yet. **Ticket 05 should drop that and pass a real toolchain**, and extend `RecordingGateway`/the live command to record toolchain outcomes. The options are stored in the Recording's `settings`, and `auditOptionsFrom` reads them back in the replay command.
- The transcript's last section is now "Tokens and spend", with dollars per agent and the total against the cap.

Live run (12 Nov 2026), audit of `rust/vaults/buggy` on GLM 5.3:
- `npm run check-models`: all three models answered (GLM 5.3, DeepSeek abliterated, Claude Opus 5.5).
- The Scout and the Rules agent each gave one invalid answer, and each retry was valid. The Rules agent wrote 6 Rules, each with a Rule check.
- Spend was $0.28 (the Rules agent used 44.5k output tokens, mostly reasoning).
- `npm run replay -- audits/live-buggy-1/recording.json` reproduced the live transcript line for line. The Recording holds 4 exchanges and no key. It isn't committed: `audits/` is git-ignored, and ticket 11 picks the Recording that ships.

**Problem for ticket 05/11:** `rust/vaults/buggy/src/lib.rs` has a doc comment naming the planted bug ("The planted bug: `withdraw` lowers the caller's recorded balance..."). The Scout repeated it ("planted bug: e.g. receiver_id does not exist"), so it would reach the Attacker through the source and the Scout's map. That breaks "nothing beyond the bug-class list". Strip those comments from the vault, or from what the agents read, before ticket 05's live run.
