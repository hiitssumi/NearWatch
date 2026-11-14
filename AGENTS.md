# AGENTS.md

A guide for coding agents working in this repository. People should read `README.md` first; this file covers what an agent needs to work safely.

NearWatch audits a NEAR smart contract (Rust, near-sdk) with six agents. An Attacker breaks Rules in a local NEAR sandbox. A Prover proves them in Lean 4. A Referee, which is ordinary code, re-runs both kinds of evidence and catches Conflicts. Payouts are plain NEAR testnet transfers. The demo target is `rust/vaults/buggy`, whose bug was planted on purpose.

## Start here

```bash
npm install          # Node 24 or later. No runtime dependencies, so this installs only TypeScript and the Node types.
npm run check        # typecheck, then every test. Must end with "ℹ fail 0".
npm run replay       # The whole demo Audit, offline. A good way to see what the system does.
```

No build step: Node 24 runs the `.ts` files directly, with types stripped. Imports carry the `.ts` extension (`import { x } from "./y.ts"`). Use only syntax that can be erased: no `enum`, no `namespace`, and no constructor parameter properties (`erasableSyntaxOnly` in `tsconfig.json`).

## Commands

Every command runs without prompts. Exit codes: `0` means success, `1` a failure (the reason is on stderr), `2` bad arguments or settings.

| Command | Needs | Network | Costs money | Time | Success looks like |
| --- | --- | --- | --- | --- | --- |
| `npm run check` | Node | no | no | under 1 min without the slow tests, about 2.5 min with them | `ℹ fail 0` |
| `npm run typecheck` | Node | no | no | seconds | no output |
| `npm test` | Node; the slow tests also need Rust, the built sandbox and Lean, and are skipped without them | no | no | under 1 min, or a few minutes with the slow tests | `ℹ fail 0` |
| `npm run replay -- [recording]` | Node | no | no | seconds | the transcript, ending with `== Payouts ==` |
| `npm run replay -- --verify` | Rust and Lean | no | no | about 2.5 min after the first build | `VERIFIED: 26 Scenario runs and 19 Lean checks ...` |
| `cd rust && cargo test` | Rust, cargo-near 0.23.0 | the first run downloads the sandbox | no | a few minutes at first | every test `ok` |
| `npm run scenario -- <audit>/scenarios/S4.json` | Rust, the built harness | no | no | seconds | `Rule check: TRUE (the Rule is broken)` for a Finding |
| `npm run check-models` | a NEAR AI key in settings | yes | about $0.001 | seconds | one `OK` line per model |
| `npm run audit -- rust/vaults/buggy` | all of the above | yes | **yes, up to the $5 cap** | 15 to 95 min | `== Verdicts ==`, then `Recording: ...` |
| `npm run setup-accounts` | a testnet account in settings | yes, testnet | testnet NEAR only | about a minute | one line per account |
| `npm run deploy-vaults` | Rust and a testnet account in settings | yes, testnet | testnet NEAR only | a few minutes | `0.1 NEAR lost (the planted bug)` and `nothing lost` |
| `npm run record-lean` | Lean | no | no | about a minute | rewrites `test/lean/lean-outcomes.json` |

Install steps for Rust are in `rust/README.md`. For Lean, install elan and run `elan default stable`; Mathlib is not used. To use a Lean binary that is not on `PATH`, set `NEARWATCH_LEAN` to its path. The sandbox harness is built with `(cd rust && cargo build --release -p nearwatch-harness)`.

## Rules for agents

- **Never run `npm run audit` unless the human asks for it.** It spends real money on NEAR AI Cloud. To exercise the Audit pipeline, use `npm run replay` or the tests, which replay Recordings.
- **Only the human runs `setup-accounts` or `deploy-vaults`.** They send real testnet transactions from the human's account.
- **Never read out, print, log or commit `settings.local.json`.** It holds the NEAR AI key and a testnet secret key, and it is ignored by git. Change settings only by editing named fields, never by echoing the file. Errors in `src/near/keys.ts` never include a key's text; keep it that way.
- **Testnet only.** Payments and deployments refuse any account that is not `*.testnet` and any RPC whose `chain_id` is not `testnet`. Never weaken these checks, and never add mainnet support.
- **Do not edit the files in `recordings/` by hand.** They are real runs: the replay and the tests check against them, and `--verify` re-runs them against the real sandbox and Lean. A new Recording comes from a live Audit.
- **No new runtime dependencies.** The project uses only Node's standard library (`node:crypto` for ed25519, `fetch` for RPC and LLM calls). Ask before adding a package.
- **The Referee, the Ledger and the proof rules are deterministic code.** No LLM may decide a verdict, a Payout or whether a proof counts. LLMs only propose, and they may word explanations.

## Where things are

```
src/
  domain.ts         The domain types, named after GLOSSARY.md. Start here.
  audit.ts          The Audit runner: agents in order, the Referee, Conflicts, Refinements, Payouts.
  referee.ts        The Referee (no LLM): re-runs Scenarios, accepts or rejects proofs, finds Conflicts.
  proof-rules.ts    What makes a proof count: Lean accepts it, no `sorry`, only the three standard axioms.
  ledger.ts         Verdicts to Payouts: pure arithmetic, sends nothing.
  ports.ts          The interfaces behind which LLMs, the sandbox, Lean and payments are swapped for recorded ones.
  live-audit.ts     Builds a live Audit from settings and the local toolchain.
  agents/           Scout and Rules agent (agents.ts), attacker.ts (BUG_CLASSES), prover.ts, reporter.ts, ask.ts (spend cap).
  llm/              live.ts (NEAR AI Cloud, OpenAI-compatible) and recording.ts (stores every exchange).
  near/             A small NEAR client with no packages: rpc.ts, transaction.ts (Borsh and signing), keys.ts,
                    payments.ts (testnet transfers), deploy.ts (the demo vaults on testnet).
  replay/           recording.ts (load and replay), verify.ts (--verify), continue.ts (--continue-from).
  sandbox.ts        Runs a Scenario through the Rust harness. Also buildContract().
  lean.ts           Checks a Lean file with the local Lean.
  cli/              One file per npm script.
rust/
  vaults/buggy      The demo vault with the planted bug.
  vaults/fixed      The same vault with a callback that restores the balance.
  vaults/tests      near-workspaces tests that confirm the bug on the real contract.
  harness           nearwatch-harness: runs one Scenario in a fresh sandbox and evaluates its Rule check.
test/
  *.test.ts         Fast tests that replay Recordings and fixtures and need only Node.
  *.slow.test.ts    Tests against the real sandbox, a local NEAR node and Lean, skipped when those are missing.
  lean/             Lean fixtures, and lean-outcomes.json, Lean's recorded verdicts that the fast tests replay.
recordings/         Real Audits. demo-buggy-vault.json is the default for replay.
deployments/        testnet.json: the deployed vault accounts and the demonstration transaction hashes.
docs/adr/           Architecture decisions. Read 0001 before changing the Formalization or Refinement logic.
.scratch/           The issue tracker: a spec and numbered tickets as markdown (see docs/agents/issue-tracker.md).
audits/             Output of live Audits. Ignored by git.
```

## Reading results as data

An Audit folder (`audits/<timestamp>/`) holds machine-readable files beside `transcript.txt` and `report.md`:

- `recording.json`: every LLM answer, sandbox outcome, Lean outcome and transaction hash. Replay it with `npm run replay -- <path>`.
- `rules.json`, `properties.json`, `scout-map.json`, `conflicts.json`, `payouts.json`.
- `scenarios/S<n>.json`: each one re-runs with `npm run scenario`.
- `formalization.lean`, `proofs/`, `refinements/`: the Lean files as checked.

`deployments/testnet.json` lists the testnet vault accounts, their deploy hashes and the demonstration's ledger readings.

## Words

Capitalised terms (Audit, Rule, Property, Formalization, Scenario, Finding, Conflict, Refinement, Counterexample, Recording, Fee, Payout, and the agent names) have exact meanings in `GLOSSARY.md`. Use them that way in code, tests, transcripts and docs. If a change needs a new term, add it to the glossary. Record a decision as an ADR only if it is hard to reverse and surprising without context.

## Changing things safely

1. Find or write the ticket in `.scratch/nearwatch-audit/issues/`.
2. Write a failing test first. Fast tests replay a Recording or a hand-made fixture (`test/hand-made.ts`), so they need no network or keys.
3. Run `npm run check`. If you touched `rust/`, also run `cd rust && cargo test`. If you touched how Scenarios or proofs are checked, run `npm run replay -- --verify`.
4. If the transcript's wording changes, check the lines `README.md` quotes in step 1. They are a promise to readers.
5. Commit only when the human asks.
