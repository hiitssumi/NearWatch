# 15: Replay with verification

**What to build:** A flag on the replay command that re-runs every Scenario in the sandbox and re-checks every proof with Lean, for anyone who has Rust and Lean installed, and compares each result with the Recording. It shows the Recording is not fiction. Should-have. This is the second ticket dropped if time runs out.

**Blocked by:** 11

**Status:** ready-for-agent

- [ ] With the flag, replay uses the real toolchain for every Scenario and every proof, and the stored LLM answers for everything else.
- [ ] Each real outcome is compared with the recorded one. Any difference fails the replay with a message that names the Scenario or proof.
- [ ] When Rust or Lean is missing, the message says which one and how to install it.
- [ ] Slow test: replay with verification passes on the shipped Recording.
- [ ] Slow test: it fails when a recorded outcome has been altered.
- [ ] The README gains a "do X, see Y" step for it.
