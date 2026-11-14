# Spec: NearWatch Audit

Status: ready-for-agent

Written 11 Nov 2026 from `BRIEF.md`. Terms in capitals are defined in `GLOSSARY.md`. Respect `docs/adr/0001` (the first Formalization is coarse) and `docs/adr/0002` (near-workspaces for the sandbox).

## Problem Statement

A team about to deploy a NEAR contract that holds money has two ways to check it. A human audit is slow and expensive. A single AI scan is fast, but it produces claims nobody can check: a list of "possible issues" with no proof that any of them is real, and no evidence for the parts it calls safe.

Formal proofs sound like the answer, but a proof is only about a description of the contract that somebody wrote. If the description leaves out how the contract really behaves, the proof is correct and the contract is still broken. Nothing in a proof-only tool tells the team when that has happened.

## Solution

The team runs one command on a contract. Six agents audit it and each Rule about the contract ends with one verdict, Broken, Proven or Unproven, that rests on evidence the Referee re-ran itself.

- A Broken verdict comes with a Scenario anyone can re-run in a local sandbox.
- A Proven verdict comes with a Lean proof anyone can re-check, and a statement of what the proof does and does not cover.
- When an exploit contradicts a proof, NearWatch says so, corrects the description the proof was written against, and shows the result.

The agents are NEAR accounts and are paid from the Audit's Fee according to whose evidence held up.

A reviewer who has no keys and no toolchain can replay a recorded Audit and see the whole thing.

## User Stories

### The contract's owner

1. As a contract owner, I want to start an Audit with one command and a path to my contract, so that I do not need to learn each agent's tooling.
2. As a contract owner, I want a map of where money enters, sits and leaves my contract, so that I can see what the Audit considered.
3. As a contract owner, I want to see which methods are privileged and who can call them, so that I know who can change the contract's behaviour.
4. As a contract owner, I want to be told that key and upgrade control cannot be read from source alone, so that I check the deployed account's keys myself.
5. As a contract owner, I want the Rules written in plain English, so that I can judge whether they are the right Rules.
6. As a contract owner, I want one verdict per Rule, so that I know where I stand on each.
7. As a contract owner, I want every Broken verdict to come with a Scenario I can re-run, so that I can confirm the bug and test my fix.
8. As a contract owner, I want every Proven verdict to come with the Lean files, so that I can have the proof checked independently.
9. As a contract owner, I want the report to say that a proof covers the Formalization and not my code, so that I do not over-trust a Proven verdict.
10. As a contract owner, I want to see every Conflict a Rule went through, so that I know where the first Formalization was too simple.
11. As a contract owner, I want Leads kept separate from Findings, so that unconfirmed suspicions do not look like confirmed bugs.
12. As a contract owner, I want an Unproven verdict to be stated plainly, so that I do not mistake "no bug found" for "safe".
13. As a contract owner, I want a plain-English report, so that I can share the result with people who do not read Rust or Lean.
14. As a contract owner, I want to see what the Audit cost in LLM calls, so that I can judge whether it was worth it.
15. As a contract owner, I want the cost of each proof attempt listed, so that I can see what a proof costs.
16. As a contract owner, I want the Attacker to touch only a local sandbox, so that my deployed contract and other people's contracts are never attacked.
17. As a contract owner, I want all results written to one folder, so that I can keep them with my code.
18. As a contract owner, I want to be told clearly when my contract is not a supported kind, so that I do not get a meaningless result.

### The person paying

19. As the payer of an Audit, I want the Fee fixed before the Audit starts, so that I know what I will spend.
20. As the payer, I want each agent paid from the Fee after the verdicts, so that payment follows results.
21. As the payer, I want the Attacker paid only for Findings the Referee reproduced, so that I do not pay for invented bugs.
22. As the payer, I want the Prover paid only for Proven verdicts, so that I do not pay for proofs that were overturned.
23. As the payer, I want the share for a Rule that ended Unproven returned to me, so that I do not pay for evidence nobody produced.
24. As the payer, I want the Referee's Payout to be flat, so that it has no reason to favour either side.
25. As the payer, I want a transaction hash for every Payout, so that I can check each one on chain.

### The builder running NearWatch

26. As the builder, I want one setup command that creates the agents' accounts under my parent account, so that I do not create seven accounts by hand.
27. As the builder, I want the model for each agent to be a setting, so that I can develop on cheap models and record on strong ones.
28. As the builder, I want a spend cap per Audit, so that a looping agent cannot empty my credits.
29. As the builder, I want an Audit that hits its cap to finish with the verdicts it has, so that I still get a usable result.
30. As the builder, I want every live Audit recorded automatically, so that any run can become the replay.
31. As the builder, I want to choose which Recording ships as the replay, so that the demo shows a run I have checked.
32. As the builder, I want a readable transcript printed agent by agent, so that I can record the terminal as the demo video.
33. As the builder, I want an agent's malformed answer retried a limited number of times, so that one bad reply does not end the Audit.
34. As the builder, I want keys read from a local file that is never committed, so that I cannot leak them.
35. As the builder, I want the Audit to run without Payouts when no testnet account is configured, so that I can develop before the accounts exist.
36. As the builder, I want a clear message when a testnet transfer fails, with the verdicts still saved, so that a slow testnet does not lose the Audit.

### The reviewer

37. As a reviewer with only Node installed, I want to replay the recorded Audit with no keys and no network, so that I can see what NearWatch does in a minute.
38. As a reviewer, I want the replay to recompute the verdicts and Payouts from the recorded evidence, so that I am watching the real decision logic and not a printed text file.
39. As a reviewer with Rust and Lean installed, I want replay with verification to re-run every Scenario and re-check every proof, so that I can confirm the Recording is not fiction.
40. As a reviewer, I want replay with verification to fail loudly if a re-run disagrees with the Recording, so that a stale or doctored Recording cannot pass.
41. As a reviewer, I want the README to say that the demo bug was planted, so that I am not misled about what was discovered.
42. As a reviewer, I want the README to say what help the Attacker was given, so that I can judge how much it found unaided.
43. As a reviewer, I want to see the Attacker's actual inputs in the Recording, so that I can confirm it was not told where the bug is.
44. As a reviewer, I want the README written as "do X, see Y" steps, so that I can verify each claimed feature.
45. As a reviewer, I want to see the Conflict in the transcript, with the Finding and the proof it contradicts side by side, so that I understand the central claim.
46. As a reviewer, I want to see the Refinement and the old proof failing against it, so that I can see the Conflict was resolved and not just reported.
47. As a reviewer, I want the transcript to show a Payout moving from the Prover to the Attacker after the Conflict, so that I can see the agents form an economy.
48. As a reviewer, I want each Payout hash to be one I can look up on a testnet explorer, so that I can confirm the payments happened.
49. As a reviewer, I want the README to list the libraries used and say the code was written with AI coding agents, so that the entry follows the rules.
50. As a reviewer, I want the README to say NearWatch is independent of NEAR AI, so that I do not mistake it for an official tool.

### Trust in the agents

51. As anyone relying on a verdict, I want the Referee to re-run every Scenario itself, so that a Finding counts because it was reproduced and not because the Attacker said so.
52. As anyone relying on a verdict, I want the Referee to re-check every proof with Lean itself, so that a proof counts because Lean accepted it.
53. As anyone relying on a verdict, I want a proof containing a placeholder or an added axiom rejected, so that an unfinished proof cannot pass.
54. As anyone relying on a verdict, I want the Prover unable to change the statement it is proving, so that it cannot prove something easier and claim the Rule.
55. As anyone relying on a verdict, I want the Attacker unable to decide for itself that a Rule is broken, so that it cannot claim a Finding with an empty test.
56. As anyone relying on a verdict, I want a Finding always to outrank a proof, so that a real exploit is never overruled by a description of the contract.
57. As anyone relying on a verdict, I want at most two Refinements before a contested proof is withdrawn, so that an Audit always ends.

## Implementation Decisions

### Shape

- One program in TypeScript on Node 24 runs the Audit. A separate Rust workspace holds the vaults and the sandbox harness. Lean files are plain files checked by the local Lean install, with no Lean package dependencies.
- An Audit runs in this order: Scout, Rules agent, then the Attacker and the Prover side by side (the Rules agent writes the Formalization on the Prover's side, before the Prover starts), then Referee, Reporter. The two sides need nothing from each other. Each side's transcript is held back and printed in a fixed order, so the transcript does not depend on which side finished first. A Conflict sends control back to the Rules agent for a Refinement, then to the Referee again.
- Four commands: one runs a live Audit on a contract path, one replays a Recording (with a flag for verification), one sets up the testnet accounts, one deploys the two vaults to testnet.
- Only Rust near-sdk contracts are accepted. Anything else is refused with a clear message before any LLM call.

### Modules

Each module below has a small interface and hides the work behind it.

- **Audit runner.** Takes a contract path and a set of ports (LLM gateway, toolchain, payer) and returns an Audit result. Owns the order of agents, the Refinement loop, the spend cap and the transcript. This is the entry point the commands call and the place the tests attach.
- **LLM gateway.** One operation: given an agent name and a prompt, return an answer and its token use. Three implementations: live (NEAR AI Cloud, OpenAI-compatible), recording (wraps live and stores every exchange), and replay (returns stored answers in order and fails if asked something that was not recorded). It also prices each call from a table in settings.
- **Toolchain.** Two operations: run a Scenario with a Rule check and return observations and a pass or fail; check a Lean file and return success or the error text plus the axioms used. Two implementations: real, and replay (returns stored outcomes).
- **Agents.** Scout, Rules agent, Attacker, Prover and Reporter are each a function from typed inputs to typed outputs that uses the LLM gateway and, for the Attacker and Prover, the toolchain. Every agent's answer is requested as structured data and validated. An invalid answer is retried up to twice, then treated as that agent producing nothing.
- **Referee.** Ordinary code with no LLM in its decisions. Given the Rules, the submitted Scenarios and the submitted proofs, it re-runs each through the toolchain, detects Conflicts, and sets verdicts. It uses the LLM gateway only to word the explanation of a Conflict and to compare a counterexample's path with the Finding's; neither decides anything.
- **Ledger.** A pure calculation from verdicts to Payouts.
- **Payer.** Two operations: collect the Fee, and send one Payout. Three implementations: testnet transfers, a fake that records what it would send, and replay (returns stored transaction hashes).
- **Sandbox harness.** A fixed Rust program built on near-workspaces 0.24. It deploys a compiled contract to a local sandbox, runs a Scenario, collects observations and reports them. It is compiled once, not once per Scenario.
- **Vaults.** The buggy demo vault and its fixed copy.

### What each agent produces

- **Scout:** the methods that move money, where balances are recorded, the privileged methods and who may call them, and a standing note that key and upgrade control must be checked on the deployed account.
- **Rules agent:** for each Rule, the plain-English text, a Rule check, and a Property. Separately, one Formalization of the contract. On a Refinement it receives the Finding and returns a new Formalization that splits only the call the Finding went through.
- **Attacker:** Scenarios and Leads. Its inputs are the contract source, the Scout's map, the Rules, the list of sandbox actions it may use, and the bug-class list. Nothing else.
- **Prover:** for each Property, a proof body, or nothing. After a Refinement, it may also return a counterexample (see "Conflicts and Refinement").
- **Reporter:** a plain-English report built from the Referee's result. It adds no claims of its own. It is one LLM call with a fixed prompt. The LLM words only a summary and one passage for each Rule, Finding and Conflict. Code writes everything that is a fact into the report around those passages: the verdicts, each Finding's call and observations and the command that re-runs its Scenario, each Conflict's outcome and counterexample, what a proof covers, the Leads (apart from the Findings), the Audit's cost by agent and the cost of each proof attempt. Its answer is rejected, and retried like any invalid answer, if it names a Rule, Finding or Conflict that does not exist, leaves one out, or uses a verdict word other than that Rule's own. With no valid answer, the Audit completes without a report and the Reporter's share returns to the payer. The report is written to the Audit's folder as `report.md`, and the transcript says where.

### Scenarios are data, not code

- A Scenario is setup actions followed by one call under test. A setup action creates a named account with a balance, calls a contract method as a given account with given arguments, attached deposit and gas, or reads a view method. Any account named may be one that does not exist.
- The harness records observations just before and just after the call under test: results of view calls, account balances, and which receipts failed. Before each observation it lets a few blocks pass, so gas refunds and returned deposits have landed.
- A Rule check is a small comparison over those observations, written by the Rules agent, that is true when the Rule has been broken. It names the methods it is about, and the call under test must be one of them. For each observation it says what to read, in terms of the call under test (its signer, the contract, or one of its arguments) or a fixed account name. It may also compare an account (such as the signer) with another account or with a view that returns one, using only equal or not equal, so a Rule about who may call a method can say the signer is not the owner. The Attacker chooses only the setup and the call (see `docs/adr/0003`).
- The harness, not the Attacker, evaluates the Rule check. A Scenario is a Finding only if the Referee's own run reports the Rule check true. Otherwise it is a Lead.
- Reasons: the Attacker cannot fake a Finding, no LLM-written code is executed on the builder's machine, and the slow Rust compile happens once.

### The Attacker's budget and hints

- The bug-class list: state not restored when a cross-contract call or transfer fails; state updated after an external call is scheduled, so a second call can slip in between; a privileged method with no access check; a callback that anyone can call directly; attached deposits counted wrongly; balance arithmetic that can overflow or underflow; a callback starved of gas so it never runs.
- For each Rule the Attacker tries each bug class, with up to three Scenario attempts per pair, and stops at the first Finding for that Rule.

### Proofs

- The Property's statement belongs to the Rules agent. The Prover supplies only the proof body. The file Lean checks is assembled by the toolchain from the Formalization, the Property statement and the proof body, so the Prover cannot alter what is being proved.
- A proof passes only if Lean accepts the file and the axioms it reports are within the standard set. Any use of a placeholder fails the check.
- The Prover's loop is: write a proof body, check it, read Lean's errors, try again. Up to twelve rounds or ten minutes per Property, whichever comes first.
- Each attempt's tokens, dollars and time are logged against the Property.
- The ten minutes are counted from the recorded duration of each LLM call and Lean check, not from the clock, so a replay stops the Prover's loop exactly where the live run stopped it.
- Before the Prover starts, each Property statement is compiled against the Formalization with a placeholder proof. If Lean rejects it, the Rules agent is given Lean's errors and rewrites the Formalization and Properties, up to twice. With none that compiles, there is nothing to prove and every Rule without a Finding ends Unproven.
- Lean runs code while it checks a file (`#eval` needs no imports). So LLM-written Lean is screened before Lean sees it: a Formalization or Property statement may contain only plain definitions (no commands, imports, options, axioms, placeholders, unsafe or foreign code, or new syntax), and a proof body only tactics.

### The Formalization

- State: each account's recorded balance, each account's total deposited and total received (kept only so Rules can be stated), the owner, and whether deposits are paused.
- Steps: one per contract call. In the first Formalization every call is a single step, as `docs/adr/0001` requires.
- A Refinement splits one call into a start step and a resolve step with a success branch and a failure branch.

### Conflicts and Refinement

- A Conflict exists when the Referee has reproduced a Finding against a Rule and has also accepted a proof of that Rule's Property.
- On a Conflict, the Rules agent writes a Refinement. The Referee re-checks the existing proof against it. If the proof no longer passes, the Conflict is resolved. This re-check is the must-have.
- After the Refinement that resolves the Conflict, the Prover gets the restated Property, with the Finding, and may answer with a proof of it or a counterexample to it, within the same round, time and spend limits as a proof attempt. A counterexample that matches the Finding is the strongest outcome and is a should-have.
  - A counterexample is a list of Lean terms (values for the Property's variables, then proofs of its hypotheses, often `rfl`) and a tactic block. The toolchain assembles a theorem stating the negation of the Property, applies the Property to those terms in order, and leaves the tactic block to derive False. So the values are concrete, and the counterexample cannot change the Property.
  - Each value and the tactic block are screened like a proof body. The Referee re-checks the counterexample with Lean itself, under the same proof rules (standard axioms only).
  - The transcript shows the counterexample beside the Finding, with the Prover's one-sentence account of its steps, and says whether they follow the same path: the same call, the same outcome of any transfer (it lands or fails), and the same kind of wrong state. An LLM makes that comparison; it decides nothing, because the counterexample is checked by Lean and the Rule is Broken either way.
  - A proof of the restated Property is re-checked too, and means the Refinement still does not show the Finding. Neither outcome, nor finding nothing within the budget, changes any verdict or Payout.
- If the proof still passes after two Refinements, it is withdrawn. If the Rules agent writes no Refinement that compiles (up to two retries, as for the first Formalization), the Conflict stays unresolved.
- At a Conflict the transcript shows the Finding (its call and what was observed) and the proof it contradicts (the Property and the proof body), then a short explanation of why they disagree. An LLM words the explanation; it decides nothing.
- Each Refinement and each re-check, with Lean's errors, is written to the Audit's folder, and so is the counterexample (or proof) the Referee checked after the Refinement.
- In every case the Rule ends Broken, because a Finding outranks a proof.

### Verdicts

- Broken: the Referee reproduced a Finding against the Rule.
- Proven: the Referee accepted a proof and no Finding stands.
- Unproven: neither.

### Payment

- The Fee is 1 testnet NEAR per Audit.
- Flat shares: Scout 5%, Rules agent 10%, Reporter 5%, Referee 20%.
- The remaining 60% is split evenly across the Rules. A Rule's share goes to the Attacker if the Rule ended Broken, to the Prover if it ended Proven, and back to the payer if it ended Unproven.
- At the moment of a Conflict the transcript shows the Prover's claim on that Rule's share being cancelled and passing to the Attacker.
- A share for an agent that did not run is returned to the payer.
- Accounts: one sub-account per agent and one for the payer, all under the builder's parent account. The Fee moves from the payer to the parent at the start, Payouts move from the parent to the agents at the end, and anything left returns to the payer. All are plain transfers. No payment contract is written.
- With no testnet account configured, the Audit runs with the fake payer and says so in the transcript.
- Sub-accounts are named `<agent>.<parent>` and `payer.<parent>`. The setup command creates each with the parent's key as its full-access key, so the one key in settings signs for the parent and for the payer; agents' accounts only receive. It gives an agent's account 0.01 NEAR to exist and brings the payer's account up to 1.5 NEAR, topping it up when it falls below 1.1 NEAR. Running it again leaves what exists alone.
- Transactions are serialized and signed in this program with Node's own ed25519, and sent over NEAR JSON-RPC: no NEAR package is a dependency. Queries read the latest block, not the last final one, and the last nonce used per signer is remembered, so two payments in a row never reuse a nonce.
- The Fee is collected before any agent runs. If it cannot be collected (no payer account, or too little in it), no agent runs, nothing is spent, and the message says what to do.
- Each payment's transaction hash is printed in the transcript, with the address to look one up on a testnet explorer. A Payout that fails is listed as not paid with the chain's reason, the other Payouts are still sent, a summary line gives what was not paid, and the verdicts, the Audit's folder and the Recording are saved as usual. Unpaid money stays in the parent account.
- Payments are sent on testnet only. Settings that name a parent account not ending in `.testnet` make no payer at all, and before its first transaction the payer asks the RPC node which network it is on and refuses anything other than testnet. The parent's key is used only to sign: it is never printed, never put in an error, and never stored in a Recording or the Audit's folder.

### The demo vault

- Methods: deposit, withdraw to a named receiver, a balance view, and an owner-only switch that pauses deposits. No owner method touches balances.
- The planted bug: withdraw reduces the caller's recorded balance and sends the money with an asynchronous transfer, and nothing restores the balance when that transfer fails. A withdrawal to an account that does not exist is one way the transfer fails.
- The fixed copy restores the balance in a callback when the transfer fails.
- Both vaults keep NEAR attached to a call of a read-only method (such as `balance_of`), credited to nobody: near-sdk rejects attached NEAR only on methods that change state, and a read-only method cannot check for it without breaking ordinary view calls. This is accepted as real NEAR behaviour, not part of the planted bug. If an Audit of the fixed vault finds it, the result says so plainly.
- Rule 1: a user's recorded balance only goes down by an amount that user actually received. Rule 2: the owner cannot reduce any user's balance.
- This description is never given to the Attacker.
- Both vaults are also deployed on NEAR testnet under the builder's parent account (`buggy-vault.<parent>`, `fixed-vault.<parent>`), by a fourth command that refuses any account or RPC not on testnet. The same command shows the planted bug there with real calls: a deposit, then a withdrawal to an account that does not exist. Audits do not use these deployments: the Attacker still runs every Scenario in a local sandbox.

### Recording and replay

- A Recording holds, in order: every LLM exchange with its agent and token use, every toolchain outcome, every Payout hash, the settings used, and the commit it was made from. For an Audit that paid for real it holds the Fee's hash and, for each Payout, its hash or the reason it was not paid. The replay payer returns these in order, fails clearly if the Ledger asks for a Payout the Recording does not hold there, and sends nothing. A Recording made with the fake payer stores no payments and replays with the fake payer.
- Plain replay feeds the Recording through the same Audit runner with the replay gateway, replay toolchain and replay payer. The Referee and the Ledger run for real on the recorded evidence.
- Replay hands each agent its own exchanges in order, and Scenario runs and Lean checks each in their own order. The Attacker runs only Scenarios and the Prover's side only Lean checks, so the part that runs side by side replays exactly, however its calls interleaved in the live run.
- A live Audit may continue an earlier Recording of the same contract source: the earlier answers and outcomes are replayed in the same per-agent and per-kind orders, and only what the Recording does not hold goes to the live model and toolchain. This runs a step added after a Recording was made without paying for the whole Audit again. The new Recording holds everything, replays on its own, and states what it continued from and how many exchanges and outcomes were replayed and how many were live.
- Replay with verification uses the real toolchain and compares each outcome with the recorded one. Any difference fails the replay with a message naming the Scenario or proof.
  - It is a flag on the replay command (`--verify`). The LLM answers and the payment hashes still come from the Recording.
  - A Scenario's re-run must give the same observations, failed receipts and Rule check result (or the same reason it could not be run). A Lean re-check must give the same acceptance, the same error text and the same axioms; how long it took is not compared.
  - The first difference is final: nothing more is re-run, and it is reported even though the agents treat a Scenario that throws as one that "could not be run" and would carry on.
  - It refuses to start if the contract at the recorded path is no longer the source the Recording audited, and it fails if the Recording holds outcomes the replay never asked for.
  - When Rust or Lean is missing it says which, and how to install it, before anything runs.
- One checked Recording of the demo vault ships in the repository as the default replay.

### Output

- The transcript is plain text, printed agent by agent, with the Conflict, the Refinement, the verdicts, the Payouts and the total spend each clearly marked.
- An Audit writes a folder holding the Scout's map, the Rules, each Formalization, the Properties and proofs, the Scenarios, the verdicts in a machine-readable form, the report, the costs and the Payouts.

### Settings and limits

- Settings come from a local file that is never committed: the NEAR AI key, the model for each agent, the parent account and its key, and the spend cap. The repository carries an example file with names only.
- Starting models: the Attacker on NEAR AI's uncensored DeepSeek model, the Prover on Claude Opus, the others on GLM 5.3. Exact ids and prices are in `BRIEF.md` section 8.
- The spend cap per Audit defaults to $5. When it is reached, running agents stop, unfinished Scenarios become Leads, unfinished proofs count as no proof, and the Audit continues to the Referee.
- While the Attacker and the Prover run side by side, each side may spend half of what is left under the cap. Whether a side is stopped then depends only on its own spending, so a replay stops it exactly where the live run did.

### README and licence

- MIT licence.
- The README is written as "do X, see Y" steps and states, near the top, every admission listed in `BRIEF.md` section 7.

## Testing Decisions

A good test here checks what an Audit produces, given its inputs, and nothing about how the agents arrive at it. Tests never call a live LLM: live runs cost money and give different answers each time.

### Seam 1: the Audit, run from a Recording

Tests call the Audit runner with a Recording and the fake payer, and check the result: the verdict for each Rule, the Conflicts, the Refinements, the Payouts and the key lines of the transcript.

Fast tests use the replay toolchain and need only Node:

- The shipped Recording of the buggy vault ends with Rule 1 Broken, Rule 2 Proven, one Conflict, one Refinement, and the Rule 1 share paid to the Attacker.
- A Recording whose proof contains a placeholder ends with that proof rejected.
- A Recording whose proof relies on an added axiom ends with that proof rejected.
- A Recording whose Scenario does not make the Rule check true ends with a Lead and no Finding.
- The shipped Recording of the fixed vault ends with no Finding, no Conflict, every Rule Proven, and the Attacker's attempts and skipped bug classes kept as Leads.
- A Recording where the proof still passes after two Refinements ends with the proof withdrawn and the Rule Broken.
- A Recording with no Finding and no proof for a Rule ends with Unproven and that share returned to the payer.
- A Recording that reaches the spend cap ends with verdicts and no crash.
- An invalid agent answer is retried, and an agent that never answers validly counts as producing nothing.
- Payouts always sum to the Fee, and the Referee's Payout is the same whatever the verdicts.
- A replay asked for an exchange that is not in the Recording fails with a clear message.

Slow tests use the real toolchain and need Rust and Lean:

- Replay with verification passes on the shipped Recording.
- Replay with verification fails when a recorded outcome is altered.

### Seam 2: the vaults' public methods, in the sandbox

Ordinary contract tests on near-workspaces:

- Deposit then withdraw returns the money and clears the balance, on both vaults.
- A withdrawal whose transfer fails leaves the balance reduced on the buggy vault and restored on the fixed vault.
- Only the owner can pause deposits, and pausing changes no balance.

### What is not tested separately

Agent prompts, the Prover's retry loop and the Attacker's search are exercised only through Seam 1 or in live runs. The Reporter's wording is not tested.

### Prior art

The repository has no code yet, so there is none inside it. For Seam 2, the model is the fungible-token sandbox tests in near-sdk-rs, including its failed-transfer case. Seam 1 uses Node's built-in test runner.

## Out of Scope

- Payment through NEAR Intents, and any mainnet transaction.
- A web page. It is built only if Saturday is free.
- Contracts not written in Rust with near-sdk.
- Results for any contract other than the demo vaults. A run on an unseen contract is an experiment and is reported as one.
- Proving anything about Rust or WebAssembly directly.
- Findings that break no stated Rule.
- Scenarios that need a helper contract deployed, or anything beyond the listed sandbox actions.
- Agents signing their own submissions on chain. Agent accounts only receive Payouts.
- NEAR AI Red's sandbox tool.
- Any claim of private or confidential inference.
- Accounts, billing, or anything a paying customer would need.

## Further Notes

### Build order

1. The vaults and their Seam 2 tests, so the planted bug is confirmed before any agent looks for it.
2. The sandbox harness, Scenarios and Rule checks.
3. The Audit runner with the LLM gateway in recording and replay form, so every later step can be tested from a Recording.
4. Scout, Rules agent and Attacker, up to a reproduced Finding. This is Thursday's milestone.
5. In parallel with step 4: a spike of the Prover's loop on Rule 1 against the first Formalization. This is the Lean checkpoint.
6. The Referee, Conflict detection and the Refinement re-check.
7. The Ledger and the Payer.
8. Plain replay from a checked Recording. Steps 6 to 8 are Friday's milestone.
9. README, licence, video.
10. Should-haves, in this order of being dropped: the fixed vault's Audit, replay with verification, the Reporter.

### If the Lean checkpoint is missed

Lean is dropped. The Rules agent writes the Formalization as a small executable state machine in TypeScript, and the Prover becomes a randomised tester that runs many step sequences against each Rule. A Rule that survives is labelled "checked, not proven" and no Rule is called Proven. The Conflict still works, because the first Formalization still treats withdraw as one step. Everything else in this spec stands.

### Known limits to state in the README

- A Rule's Property and its Rule check are two LLM-written versions of the same plain-English Rule. Nothing proves they mean the same thing.
- The Formalization is written by an LLM reading the code. A Proven verdict is only as good as that reading.
- The Attacker can only express attacks that fit the listed sandbox actions, and a Rule check sees only what one call changes. A bug that needs two calls to interleave cannot be expressed.

### Open risk

The first Formalization is expected to make Rule 1 provable, and the Prover is expected to prove it. If the Prover cannot, there is no proof to contradict and no Conflict to show. The spike in build step 5 exists to find this out on Thursday.
