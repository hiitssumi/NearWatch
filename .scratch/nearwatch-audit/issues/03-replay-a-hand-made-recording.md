# 03: Replay a hand-made Recording

**What to build:** The thinnest complete Audit. A replay command reads a Recording, runs it through the Audit runner with the replay LLM gateway, the replay toolchain and a fake payer, prints a transcript, and returns an Audit result. In this ticket the Recording is small and written by hand: one Scout answer, one Rules agent answer with two Rules, and one Attacker Scenario whose recorded outcome makes Rule 1's Rule check true. The result is Rule 1 Broken and Rule 2 Unproven. This puts the first test seam from the spec in place, so every later ticket can be tested from a Recording.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] A TypeScript project on Node 24 with a replay command.
- [ ] The Audit runner takes a contract path and its ports (LLM gateway, toolchain, payer) and returns an Audit result. The command only reads arguments and prints.
- [ ] The LLM gateway has one operation: given an agent name and a prompt, return an answer and its token use.
- [ ] The replay gateway returns stored answers in order, and fails with a clear message if asked for an exchange that is not in the Recording.
- [ ] Every agent's answer is structured data and is validated before use.
- [ ] The Referee is ordinary code. It sets Broken when the toolchain outcome says the Rule check is true, and turns a Scenario whose outcome is false into a Lead.
- [ ] The transcript is plain text, printed agent by agent.
- [ ] Fast test at the Audit seam, using Node's built-in test runner: the hand-made Recording ends with Rule 1 Broken and Rule 2 Unproven.
- [ ] Fast test: a Recording whose Scenario does not make the Rule check true ends with a Lead and no Finding.
- [ ] Fast test: a replay asked for a missing exchange fails with a clear message.
- [ ] Everything in this ticket runs with only Node installed: no keys, no network, no Rust, no Lean.
