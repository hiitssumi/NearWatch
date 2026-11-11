# 03: Replay a hand-made Recording

**What to build:** The thinnest complete Audit. A replay command reads a Recording, runs it through the Audit runner with the replay LLM gateway, the replay toolchain and a fake payer, prints a transcript, and returns an Audit result. In this ticket the Recording is small and written by hand: one Scout answer, one Rules agent answer with two Rules, and one Attacker Scenario whose recorded outcome makes Rule 1's Rule check true. The result is Rule 1 Broken and Rule 2 Unproven. This puts the first test seam from the spec in place, so every later ticket can be tested from a Recording.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] A TypeScript project on Node 24 with a replay command.
- [x] The Audit runner takes a contract path and its ports (LLM gateway, toolchain, payer) and returns an Audit result. The command only reads arguments and prints.
- [x] The LLM gateway has one operation: given an agent name and a prompt, return an answer and its token use.
- [x] The replay gateway returns stored answers in order, and fails with a clear message if asked for an exchange that is not in the Recording.
- [x] Every agent's answer is structured data and is validated before use.
- [x] The Referee is ordinary code. It sets Broken when the toolchain outcome says the Rule check is true, and turns a Scenario whose outcome is false into a Lead.
- [x] The transcript is plain text, printed agent by agent.
- [x] Fast test at the Audit seam, using Node's built-in test runner: the hand-made Recording ends with Rule 1 Broken and Rule 2 Unproven.
- [x] Fast test: a Recording whose Scenario does not make the Rule check true ends with a Lead and no Finding.
- [x] Fast test: a replay asked for a missing exchange fails with a clear message.
- [x] Everything in this ticket runs with only Node installed: no keys, no network, no Rust, no Lean.

## Comments

**Done (11 Nov 2026).** Run: `npm run replay` (plays `recordings/hand-made.json`), `npm test`, `npm run typecheck` (after `npm install`, dev deps only; runtime has no dependencies, Node 24 runs the `.ts` files directly).

Layout: `src/audit.ts` (Audit runner), `src/ports.ts` (LLM gateway, toolchain, payer, source reader), `src/agents/` (Scout, Rules agent, Attacker; `ask.ts` validates and retries an invalid answer up to twice), `src/referee.ts`, `src/replay/recording.ts` (Recording format, replay gateway, replay toolchain, fake payer), `src/cli/replay.ts`.

Decisions later tickets should know:
- A Rule check declares named **slots** (`view` or `balance`) and a condition over them; each Scenario **binds** every slot to a concrete view call or account. The harness (ticket 02) evaluates it; types in `src/domain.ts`, validators in `src/schemas.ts`.
- Observations "before" are taken once the Scenario's opening `createAccount` actions have run, so a fresh account's starting balance is visible. Ticket 02 should implement that.
- The runner reads the contract source through a fourth small port, `source`, so replay needs no contract file on disk.
- In this ticket the Referee runs each submitted Scenario once (one toolchain outcome per Scenario). Ticket 05 adds the Attacker's own runs before it.
- Payer port and fake payer exist but nothing is paid yet (ticket 09).
