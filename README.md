# NearWatch

NearWatch audits a NEAR smart contract with six agents. An Attacker tries to break each Rule the contract should obey, in a local sandbox. A Prover tries to prove the same Rules in Lean. A Referee, which is ordinary code, re-runs both kinds of evidence and catches them when they contradict each other. The agents are NEAR testnet accounts, paid from a fixed Fee according to whose evidence survived.

## Read this first

- **The demo vault was written for this project, and its bug was planted.** `rust/vaults/buggy` lowers a user's recorded balance on withdraw and sends the NEAR in a separate receipt; if that transfer fails, nothing puts the balance back. `rust/vaults/fixed` is the same vault with a callback that does.
- **The Attacker is given a list of known bug classes, but not the bug's location.** The list is the seven classes in `src/agents/attacker.ts` (`BUG_CLASSES`). The prompts also carry guidance, disclosed under [What the agents are told](#what-the-agents-are-told).
- **A proof covers the Formalization, not the contract's code.** The Formalization is a description of the contract in Lean, written by an LLM reading the Rust. "Proven" means proved for that description. Nothing here is proved about Rust or WASM.
- **Results are promised for the demo vault only.** A run on any other contract is an experiment.
- **NearWatch is independent.** It is not affiliated with NEAR AI, and it is not a rival to NEAR's own security work.
- **The code was written with AI coding agents** (Claude Code), directed and reviewed by one builder.

## 1. Replay the demo Audit on a bare machine

You need Node 24 and nothing else: no keys, no Rust, no Lean, no network after `npm install`.

```bash
git clone https://github.com/hiitssumi/NearWatch.git
cd NearWatch
npm install
npm run replay
```

You see the full transcript of one real live Audit of the buggy vault (`recordings/demo-buggy-vault.json`), agent by agent. The Referee and the Payout calculation run for real on the recorded evidence; the LLM answers, sandbox outcomes, Lean outcomes and transaction hashes come from the Recording. Look for:

- `== Scout ==` and `Money moves through: deposit ...`: the money map.
- `== Rules agent ==`: five Rules. Here withdraw is `R2` and the owner's pause is `R3`.
- `S4: Rule check TRUE on the Referee's own run -> Finding against R2`: the Attacker's Scenario S4 (alice withdraws 1 NEAR to `ghost`, an account that does not exist) broke R2, and the Referee reproduced it.
- `proof of R2: ACCEPTED`: the Prover also proved R2's Property against the first Formalization.
- `== CONFLICT on R2 ==`: the Finding and the proof it contradicts, side by side, then `Payout: the Prover's claim on R2's share is cancelled and passes to the Attacker.`
- `== Rules agent: Refinement 1 of withdraw, for R2 ==` and `R2: the old proof NO LONGER PASSES`: withdraw is split into a start step and a resolve step, and the old proof fails against it.
- `R2: the counterexample HOLDS` and `Same path: YES`: the Prover's counterexample to the restated Property, checked by Lean, follows the Attacker's path.
- `== Verdicts ==`: `R2: Broken`; R1, R3, R4 and R5 `Proven`.
- `== Payouts ==`: nine testnet transfers with their hashes, for example `attacker: 0.12 NEAR (R2 Broken) [GvHZ9QoWvWjkJPctWg18HSiiyY8s2GeVmEhrzwmCXvkk]`, and `Total spend: $0.9655`.

Look up any hash at `https://testnet.nearblocks.io/txns/<hash>`. Replay sends nothing.

Other Recordings in `recordings/`:

```bash
npm run replay -- recordings/live-fixed-vault.json
```

You see the fixed vault's Audit: `== Verdicts ==` with all five Rules `Proven`, no Finding and no Conflict. The Attacker's 21 Scenarios, including the same withdraw to a missing account, broke nothing.

## 2. Run the tests

```bash
npm test
```

You see `ℹ fail 0`. The fast tests replay Recordings and need only Node. The slow tests (`*.slow.test.ts`) use the real sandbox, a local NEAR node and Lean, and are skipped when Rust, the built sandbox or Lean is missing.

```bash
npm run typecheck
```

You see no errors.

## 3. Run the vault tests

You need Rust (see `rust/README.md` for the install steps: rustup, the `wasm32-unknown-unknown` target, cargo-near 0.23.0).

```bash
cd rust
cargo test
```

The first run builds both vaults to WASM and downloads the NEAR sandbox. You see the vault tests pass, among them `buggy_vault_loses_the_balance_when_the_transfer_fails` and `fixed_vault_restores_the_balance_when_the_transfer_fails`: the planted bug, confirmed on the real contract before any agent looks for it.

## 4. Run a live Audit

You need everything above, plus Lean 4 (install [elan](https://github.com/leanprover/elan), then `elan default stable`; no Mathlib), the sandbox harness, and a NEAR AI Cloud key.

```bash
(cd rust && cargo build --release -p nearwatch-harness)
cp settings.example.json settings.local.json
```

Put your NEAR AI key in `"nearAiKey"` in `settings.local.json`. That file is ignored by git; never commit it.

```bash
npm run check-models
```

You see one `OK` line per model, with what the call cost.

```bash
npm run audit -- rust/vaults/buggy
```

You see the transcript as it happens; lines from the Attacker's and the Prover's sides, which run at the same time, are tagged. The demo run took 15 minutes and cost $0.97 in LLM calls; others have taken up to 40 minutes and $1.75: the spend cap is $5 (`"spendCapUsd"`). It writes a folder under `audits/` with the transcript, the Recording, the Rules, the Formalization and Properties, every proof and Refinement as a Lean file, every Scenario as a re-runnable file, `payouts.json` and the Reporter's `report.md`. Re-run any Scenario in a fresh sandbox with the command the transcript prints:

```bash
npm run scenario -- audits/<folder>/scenarios/S4.json
```

You see what the harness observed before and after the call, the failed receipts, and `Rule check: TRUE (the Rule is broken)` for a Finding.

If your NEAR AI key has a spending limit and reaches it, the Audit stops with `HTTP 402: API key spend limit exceeded`; raise the limit and run it again. A model that is busy or briefly unavailable is retried for about six and a half minutes before the Audit gives up. LLM answers vary: another run may number the Rules differently, find the bug in a different round, or (rarely) fail to prove the withdraw Rule, in which case there is no Conflict to show.

**Paying on testnet.** With no testnet account in settings, the Audit uses a fake payer and says so (`SIMULATED`). To pay for real, make a testnet account holding a few testnet NEAR (a wallet, or `POST https://helper.testnet.near.org/account` with `{"newAccountId":"<name>.testnet","newAccountPublicKey":"ed25519:..."}`, which funds a new account), put its name in `"parentAccount"` and its secret key (`ed25519:...`) in `"parentKey"`, then:

```bash
npm run setup-accounts
```

You see one line per account created under yours, `payer.<name>.testnet` and one per agent, each with its transaction hash. Run it again before each Audit: it prints `already exists ..., left alone` for each account and tops the payer up to 1.5 NEAR when it holds less than 1.1. Each Audit then collects a 1 NEAR Fee from the payer before any agent runs, and pays each Payout as a plain transfer, printing its hash. Payments are refused on any network but testnet.

## How an Audit works

| Agent | What it does | Built as |
| --- | --- | --- |
| Scout | Maps where money enters, sits and leaves, and who can change the contract | One LLM call |
| Rules agent | Writes the Rules (plain English plus a Rule check over sandbox observations), their Properties in Lean, and the Formalization | LLM calls, retried until the Lean compiles |
| Attacker | Writes Scenarios (setup actions and one call) that try each bug class against each Rule; the sandbox harness runs them | LLM loop over a Rust harness on `near-workspaces` |
| Prover | Writes a proof body for each Property; Lean checks it; it retries on Lean's errors | LLM loop over the local Lean install |
| Referee | Re-runs every Scenario and re-checks every proof, detects Conflicts, sets verdicts | Ordinary code; an LLM only words explanations |
| Reporter | Writes a plain-English report around facts that code fills in | One LLM call |

- A **Finding** is a Scenario the Referee re-ran that made its Rule check true. Anything else is a **Lead**, and is never reported as a Finding.
- A proof counts only if Lean accepts it with no `sorry` and no axiom outside the standard three, and if it came from the Prover's own loop.
- A **Conflict** is a Finding against a Rule whose Property has an accepted proof. The Rules agent then writes a **Refinement** of the one call the Finding went through, and the Referee re-checks the old proof against it. After that, the Prover may give a counterexample to the restated Property, which Lean must confirm.
- Every Rule ends **Broken** (a Finding stands), **Proven** (a proof was accepted and no Finding stands), or **Unproven**. A Finding always outranks a proof.
- **Why the first Formalization is coarse:** it treats every contract call as one indivisible step, even where the code is asynchronous. That keeps proofs cheap enough to attempt, and it gives the Attacker and the Prover a real way to disagree: a Finding on the real contract shows where the description is too simple. See [`docs/adr/0001-first-formalization-is-coarse.md`](docs/adr/0001-first-formalization-is-coarse.md).
- **Payouts.** The Fee is 1 testnet NEAR. Flat shares: Scout 5%, Rules agent 10%, Reporter 5%, Referee 20% (the Referee's never depends on its verdicts). The other 60% is split across the Rules: a Rule's share goes to the Attacker if it ended Broken, to the Prover if Proven, back to the payer if Unproven.

The terms are defined in [`GLOSSARY.md`](GLOSSARY.md); the full design is in `.scratch/nearwatch-audit/spec.md`.

## What the agents are told

Besides the contract's source, the agents' prompts carry this guidance. None of it names the vault, its methods or the bug's location.

- **The Attacker** gets the seven bug classes. It is also told a general NEAR fact: a transfer or cross-contract call a method schedules runs later in its own receipt, after the method's state changes are saved, so if it fails only a callback can undo them; a method that changes state and schedules a transfer with no callback is therefore a reason to try the first class, not to skip it. And it is told that a call reserves its gas up front, about 0.1 NEAR per 100 Tgas, so the accounts it creates need that much more than they deposit.
- **The Rules agent** gets the same seven bug classes, so its Rules can be attacked. It is told to compare what a record loses or gains with what really arrived where it was meant to go; that a check must not depend on the money having moved (a failed transfer may return NEAR to the contract); that every method the Scout lists as moving money needs a Rule; that a Rule about who may call a method must compare the signer with the account allowed; and to allow for gas wherever a NEAR balance is compared.

These were added after live runs in which the agents missed the planted bug or wrote checks that could never be true. They are guidance about NEAR, not about this vault, but they did help.

## Claims about NEAR

1. The Attacker runs on NEAR AI's uncensored security model (`deepseek-ai/DeepSeek-V4.1-Flash-1017-abliterated` on NEAR AI Cloud).
2. NearWatch audits NEAR contracts written in Rust with near-sdk, and looks for bug classes specific to NEAR.
3. The Prover follows the approach of NEAR AI's published Lean research: an LLM writes a proof, Lean checks it, and the LLM retries on Lean's errors. No code is reused from it.
4. The agents are NEAR accounts, paid for evidence that survives the Referee.

NearWatch makes no other claim about NEAR. It makes no claim of private or confidential inference.

## Known limits

- A Rule's Property and its Rule check are two LLM-written versions of the same plain-English Rule. Nothing proves they mean the same thing.
- The Formalization is written by an LLM reading the code. A Proven verdict is only as good as that reading.
- The Attacker can only express attacks that fit the listed sandbox actions, and a Rule check sees only what one call changes. A bug that needs two calls to interleave cannot be expressed.

## Next step

Paying the agents through NEAR Intents instead of plain testnet transfers. Intents runs on mainnet only, so it is out of scope here.

## Built with

- **TypeScript on Node 24**, with no runtime packages: Node's own `crypto` signs NEAR transactions (ed25519) and `fetch` calls NEAR JSON-RPC and NEAR AI Cloud. Dev only: `typescript` and `@types/node`.
- **Rust**: `near-sdk` 5.30 (the vaults), `near-workspaces` 0.24 and the NEAR sandbox (the vault tests and the Scenario harness), `tokio`, `serde`, `serde_json`, `serde_path_to_error`, and `cargo-near` 0.23 to build.
- **Lean 4** (4.35), with no packages and no Mathlib.
- **NEAR AI Cloud** for every LLM call: `z-ai/glm-5.3` (Scout, Rules agent, Referee's wording, Reporter), `deepseek-ai/DeepSeek-V4.1-Flash-1017-abliterated` (Attacker), `anthropic/claude-opus-5-5` (Prover).
- **NEAR testnet** for Payouts.
- **AI coding agents**: the code, tests and documents were written with Claude Code.

## Licence

MIT. See [LICENSE](LICENSE).
