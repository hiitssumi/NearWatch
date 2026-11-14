# 15: Replay with verification

**What to build:** A flag on the replay command that re-runs every Scenario in the sandbox and re-checks every proof with Lean, for anyone who has Rust and Lean installed, and compares each result with the Recording. It shows the Recording is not fiction. Should-have. This is the second ticket dropped if time runs out.

**Blocked by:** 11

**Status:** resolved

- [x] With the flag, replay uses the real toolchain for every Scenario and every proof, and the stored LLM answers for everything else.
- [x] Each real outcome is compared with the recorded one. Any difference fails the replay with a message that names the Scenario or proof.
- [x] When Rust or Lean is missing, the message says which one and how to install it.
- [x] Slow test: replay with verification passes on the shipped Recording.
- [x] Slow test: it fails when a recorded outcome has been altered.
- [x] The README gains a "do X, see Y" step for it.

## Comments

**Done (14 Nov 2026).** `npm run replay -- [recording] --verify`.
- **On the demo Recording:** 26 Scenario runs re-run in the real sandbox and 19 Lean checks re-checked by the real Lean, every one matching. It prints `VERIFIED: 26 Scenario runs and 19 Lean checks were re-run for real, and every one matches the Recording.` and takes about two and a half minutes once the harness and vault are built.
- **Every other live Recording verifies too:** the fixed vault (21 and 15), and tickets 08, 17, 16 and 10 (28 Scenario runs each, 18 to 20 Lean checks).
- **`hand-made.json` is refused, correctly:** "The contract at rust/vaults/buggy/src/lib.rs is not the source this Recording audited". It was written by hand in ticket 03, before the vault's opening comment changed. It still replays plainly.

What it compares:
- **A Scenario:** the observations before and after, the failed receipts, and the Rule check result, or the same reason it could not be run.
- **A Lean check:** acceptance, Lean's error text and the axioms. How long it took is not compared.
- The first difference names the Scenario or proof, the field and both values, for example `Scenario S1 (run #1 of 26) does not match the Recording when re-run in the sandbox. outcome.ruleCheckTrue: recorded true, re-run false`.
- **The first difference is final.** The Attacker treats a Scenario that throws as one that "could not be run" and would carry on, so the mismatch is kept, nothing more is re-run, and it is reported at the end whatever else happened. A Recording holding outcomes the replay never asks for fails too.
- It refuses to start if the contract at the recorded path is no longer the audited source. Without Rust or Lean it says which is missing and how to install it.

What was built:
- `src/replay/verify.ts`: `VerifyingToolchain` (re-runs each outcome with the real toolchain and compares it with the Recording, returning the recorded outcome so the transcript is the Recording's own) and `firstDifference`.
- `src/cli/replay.ts`: the `--verify` flag, the Rust and Lean checks, and the source check. `localToolchain` is exported from `src/live-audit.ts`.
- **Tests.**
  - `test/verify.test.ts` (fast, with a stand-in toolchain): a full match; an altered Scenario, and one recorded as not run; an altered proof and an extra axiom; outcomes never asked for; `firstDifference`; and a machine with only Node, where `--verify` names both missing tools and plain replay still works.
  - `test/verify.slow.test.ts` (the real sandbox and Lean): the demo Recording passes, and it fails, naming the Scenario or the proof, when a recorded sandbox outcome or Lean outcome is altered.
- README step 4 (step 5 since ticket 19), "Replay with verification", and the spec's "Recording and replay".

All 116 tests pass with Rust and Lean installed (none skipped).
