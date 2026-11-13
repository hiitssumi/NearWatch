# 12: README and licence

**What to build:** A README that a hackathon reviewer, human or AI, can follow step by step to see each claimed feature, and that states plainly what is planted, what is real, and what a proof covers. Plus the licence file.

**Blocked by:** 11

**Status:** resolved

- [x] The README opens with what NearWatch is in two or three sentences. No marketing.
- [x] It is written as "do X, see Y" steps for: plain replay on a bare machine, the vault tests, a live Audit, and replay with verification if ticket 15 is done.
- [x] Near the top it states: the demo vault was written for this project and its bug was planted.
- [x] Near the top it states: the Attacker is given a list of known bug classes, but not the bug's location.
- [x] Near the top it states: a proof covers the Formalization, not the contract's code.
- [x] Near the top it states: results are promised for the demo vault only.
- [x] It states that NearWatch is independent, is not affiliated with NEAR AI, and is not a rival to NEAR's own security work.
- [x] It lists the libraries and tools used, and says the code was written with AI coding agents.
- [x] It lists the three known limits from the spec's "Further Notes".
- [x] It makes the four claims about NEAR from the brief and no others. It makes no claim of private or confidential inference.
- [x] It names payment through NEAR Intents as a next step.
- [x] It explains why the first Formalization is coarse, pointing to `docs/adr/0001`.
- [x] If ticket 18 replaced 07, it says "checked, not proven" wherever it would have said proved.
- [x] An MIT LICENSE file is present.
- [x] The example settings file is present with names only, and the real settings file is ignored by git.
- [x] Every command in the README has been run from a fresh clone and prints what the README says it prints.

## Comments

**Written (14 Nov 2026); one command not yet run from a fresh clone.** `README.md` and `LICENSE` (MIT, "Copyright (c) 2026 hiitssumi").
- The README opens with three sentences on what NearWatch is, then "Read this first": the planted bug, the bug-class list, what a proof covers, demo vault only, independence from NEAR AI, AI-written code.
- "Do X, see Y" sections: plain replay on a bare machine, the tests, the vault tests, a live Audit (with paying on testnet). Replay with verification is left out: ticket 15 is not done, and its own criteria add the step.
- **"What the agents are told"** discloses every piece of prompt guidance from tickets 05 and 08, quoted from the prompts: the Attacker's NEAR receipt fact and gas reserve, and the Rules agent's guidance (compare loss with what arrived; do not depend on money having moved; cover every money method; signer checks; gas allowance).
- The brief's four NEAR claims, word for word apart from naming the model, and no others; no claim of private inference. NEAR Intents as the next step. The coarse first Formalization, pointing to `docs/adr/0001`. The three known limits from the spec. Libraries, tools and models.
- How to make a testnet account (ticket 10's note) and that `settings.local.json` must never be committed.

**Run from a fresh clone of `main` (`6b19a3f`) with the new README and LICENSE:**
- `npm install`, `npm run replay`: every line the README quotes is printed. `npm run replay -- recordings/live-fixed-vault.json`: all five Rules Proven, no Finding, no Conflict.
- `npm run typecheck`: no errors. `npm test`: 107 tests, 104 pass, 3 skipped ("the near-sandbox binary is not built", as the README says), `fail 0`.
- `cd rust && cargo test`: every vault and harness test passes, including both failed-transfer tests.
- `cargo build --release -p nearwatch-harness`, `cp settings.example.json settings.local.json` (ignored by git), `npm run check-models`: one `OK` line per model.
- `npm run setup-accounts` (run from the main checkout, so the testnet key was not copied): `already exists ..., left alone` for each account and a top-up of the payer. The README now describes this second-run output.
- `npm run scenario -- audits/demo-2/scenarios/S4.json` (main checkout; the clone has no Audit folder): the observations, the failed receipt on `ghost`, `Rule check: TRUE (the Rule is broken)`.
- **`npm run audit -- rust/vaults/buggy` did not complete:** NEAR AI answered `HTTP 402: API key spend limit exceeded. Spent: $10.20, Limit: $10.00` on the Rules agent's first call. The builder's key has a $10 limit, which this project's live runs have used up. The command itself is the one the shipped demo Recording came from (`audits/demo-2`, run from the working copy at the clean commit `f4faff1`). The README now says what a spend limit looks like.

**Accepted by the builder (14 Nov 2026):** the demo run (`audits/demo-2`, the `npm run audit` command from the clean commit `f4faff1`) stands for the live Audit command, which could not be re-run from the fresh clone because the NEAR AI key reached its $10 spend limit.
