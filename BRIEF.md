# BRIEF: NearWatch, a swarm of agents that audits NEAR smart contracts

Status: grilled and agreed on 11 Nov 2026. This is the input to the build spec. Words in capitals (Audit, Rule, Finding, Conflict and so on) are defined in `GLOSSARY.md`. Two decisions with their reasons are in `docs/adr/`.

## 1. The idea in one paragraph

A team gives NearWatch a NEAR smart contract. Six agents audit it together: one maps where the money flows, one writes the Rules the contract should obey, one tries to break each Rule in a sandbox, one tries to prove each Rule in Lean, one checks everyone's work, and one writes a plain-English report. The agents are paid by how their evidence holds up. When the Attacker reproduces an exploit that a proof says cannot happen, the proof loses, the description of the contract it was proved against is corrected, and the Prover's pay for that proof goes to the Attacker.

## 2. Hackathon facts

Checked against nearhackathon.com and its HACKATHON.md on 11 Nov 2026. Re-read HACKATHON.md before submitting, because the organizers say dates and rules may change.

| Fact | Value |
| --- | --- |
| Submission deadline | 14 Nov 2026, 23:59 UTC. That is 05:29 on Sunday 15 Nov in Indian time. |
| Judging | 16–18 Nov 2026 |
| Prizes per track | $10K, $3K, $2K. One $55K grand prize overall. |
| Tracks | 13. One submission can list every track it fits. |
| What to submit | A public repository, a public demo post on X (video or screenshots, tagged @NEARProtocol and #NEARHackathon), and a 20–2,000 character description |
| First-pass review | Claude Code and Codex screen every project: they check that it can be reproduced and that the claimed features exist. Humans decide. |
| README | Written as "do X, see Y" steps. No marketing. Lists libraries used and AI-written code. |
| Local-only demo | Allowed, if the repository is public, the README reproduces it, and the X post has a video |
| Testnet-only | Allowed in all tracks |
| Required integrations | None |
| Submissions | One attempt per repository. Mistakes are fixed by a change request, not a resubmit. |

## 3. Who it is for

Teams about to deploy a contract on NEAR that holds money. A human audit is slow and expensive, and a single AI scan produces claims nobody can check. NearWatch gives them a verdict per Rule, where every verdict rests on something the Referee re-ran itself.

## 4. How an Audit works

NearWatch audits one contract per Audit. It accepts contracts written in Rust with near-sdk only.

Order: Scout, then Rules agent, then Attacker and Prover side by side, then Referee, then Reporter.

| Agent | Job | How much is built |
| --- | --- | --- |
| Scout | Maps where money enters, sits and leaves, and who can change the contract | One LLM call with a fixed prompt |
| Rules agent | Writes the Rules, their Properties in Lean, and the Formalization | One LLM call with a fixed prompt, called again for each Refinement |
| Attacker | Tries to break each Rule in a local sandbox | Real engineering. Built first. |
| Prover | Tries to prove each Property against the Formalization | Real engineering. Built third. |
| Referee | Re-runs every exploit test and re-checks every proof, then detects Conflicts and sets verdicts | Real engineering, in ordinary code. Built second. |
| Reporter | Writes the result in plain English for the contract's owner | One LLM call with a fixed prompt |

The rules of an Audit:

- **Findings point at Rules.** A Finding is a sandbox test that passes only when a named Rule is broken. A suspicion the Attacker could not reproduce is a Lead and is never reported as a Finding. The Attacker does not report bugs that break no stated Rule.
- **The Attacker gets hints, not answers.** It is given a short list of bug classes known on NEAR and tries each against each Rule. It is never told where a bug is.
- **The first Formalization is coarse.** It treats every contract call as one indivisible step. See `docs/adr/0001`.
- **A proof must be complete.** It counts only if Lean accepts it with no `sorry` placeholders and no added axioms. The proof must come from the Prover's own loop: the LLM writes a proof, Lean checks it, the LLM retries on errors.
- **The Referee trusts nobody.** It is code, not an LLM. A Finding or a proof counts only because the Referee reproduced it. An LLM is used only to word the explanation of a Conflict.
- **A Finding beats a proof.** A Conflict is a Finding against a Rule whose Property has a passing proof. It triggers a Refinement: a more detailed Formalization for the one call the Finding went through. At most two Refinements, after which the proof is withdrawn.
- **Three verdicts.** Every Rule ends as Broken, Proven or Unproven. The report shows any Conflicts along the way.
- **Proof cost is logged.** Tokens, dollars and time for each proof attempt, and total spend for the Audit.

## 5. Payment

Each agent is a NEAR account: a sub-account under one NearWatch parent account on testnet. An Audit starts with a fixed Fee in testnet NEAR. After the verdicts, the Fee is paid out in real testnet transactions and the transcript prints each transaction hash.

- The Attacker is paid per Finding the Referee reproduced.
- The Prover is paid per Proven verdict.
- When a proof is withdrawn after a Conflict, the Prover gets nothing for it and that share goes to the Attacker.
- The Scout, Rules agent and Reporter get a flat share.
- The Referee gets a flat share that never depends on its verdicts, since it decides who else is paid.

No payment contract is written. Payouts are plain transfers.

## 6. The demo

- **The contract:** a small vault written for this project, with deposit, withdraw and an owner.
- **The planted bug:** withdraw sends the money with an asynchronous call and does not restore the balance if that call fails.
- **Rule 1:** "A user's recorded balance only goes down by an amount that user actually received." The bug breaks it.
- **Rule 2:** "The owner cannot reduce any user's balance." Nothing breaks it.
- **What the run shows:** Rule 1 is proved against the first Formalization. The Attacker reproduces the loss. The Referee reports the Conflict. One Refinement follows, the proof now fails in agreement with the Attacker, Rule 1 ends Broken and Rule 2 ends Proven. The Prover's share for Rule 1 is paid to the Attacker.
- **What you see:** one terminal command prints a transcript agent by agent and writes the exploit tests, Lean files, verdicts and report into a folder.
- **The video:** under two minutes, a recording of the terminal: one line on the problem, the Audit, the Conflict, the Payouts, one line on NEAR's role.

A fixed copy of the vault sits beside the buggy one. Auditing it is a should-have. Rule 1 against its refined Formalization is the hardest proof in the project and is allowed to end Unproven.

## 7. What NearWatch claims, and what it admits

"Proved" means proved for the Formalization, which an LLM wrote by reading the code. It does not mean proved for the Rust or the compiled contract.

Claims about NEAR, and no others:

1. The Attacker runs on NEAR AI's uncensored security model.
2. NearWatch audits NEAR contracts and looks for bug classes specific to NEAR.
3. The Prover follows the approach of NEAR AI's published Lean research, with no code reused.
4. The agents are NEAR accounts, paid for evidence that survives the Referee.

The README states near the top:

- The demo vault was written for this project and its bug was planted.
- The Attacker is given a list of known bug classes, but not the bug's location.
- A proof covers the Formalization, not the contract's code.
- Which libraries are used, and that the code was written with AI coding agents.
- NearWatch is independent, is not affiliated with NEAR AI, and is not a rival to NEAR's own security work.
- Results are promised for the demo vault only.

NearWatch makes no claim of private or confidential inference.

## 8. Stack

| Part | Choice |
| --- | --- |
| Program that runs the agents | TypeScript on Node 24 |
| Demo vault | Rust with near-sdk |
| Exploit tests | Rust with `near-workspaces` 0.24. See `docs/adr/0002`. |
| Proofs | Lean 4 without Mathlib |
| LLM calls | All through NEAR AI Cloud, one key, OpenAI-compatible, base URL `https://cloud-api.near.ai/v1`. The model for each agent is a setting. |
| Payouts | NEAR testnet |
| Licence | MIT |

Starting models, with prices per million tokens in and out:

| Agent | Model | Price |
| --- | --- | --- |
| Attacker | `deepseek-ai/DeepSeek-V4.1-Flash-1017-abliterated` | $0.30 / $1.20 |
| Prover | `anthropic/claude-opus-5-5` | $4 / $20 |
| Scout, Rules agent, Reporter | `z-ai/glm-5.3` | $1.80 / $5.75 |

Development runs use the cheap models. Only the recorded Audit uses the expensive one. Total LLM spend is capped at $50: the free $10 of credits plus up to $40.

Installed on the build machine on 11 Nov: Rust 1.99.1 with the `wasm32-unknown-unknown` target, Lean 4.35.0. NEAR's own tools are not installed yet.

## 9. Replay

Replay plays back the stored LLM answers from one real Audit. It is a must-have and is built early, because the reviewing agents will try to run the project.

1. **Plain replay** prints the full transcript, including the recorded payout transaction hashes. It needs nothing installed beyond Node, no keys and no network.
2. **Replay with verification** also re-runs the exploit tests and re-checks the proofs for real, for anyone with Rust and Lean installed.

## 10. Scope

**Must have**
- The demo vault with its planted bug
- All six agents at the depth in section 4, except the Reporter
- The Conflict and one Refinement on Rule 1
- Verdicts for both Rules
- Payouts on testnet
- Plain replay
- README, LICENSE, demo video, post on X

**Should have, cut in this order if time runs out**
1. Audit of the fixed vault
2. Replay with verification
3. Reporter

**Stretch**
- A web page showing the run
- Trying NearWatch on a contract it has not seen, reported as an experiment

**Out**
- Payment through NEAR Intents (mainnet only; listed in the README as a next step)
- Any mainnet transaction
- NEAR AI Red's sandbox tool
- Promises about contracts other than the vault
- Proving anything about Rust or WASM directly
- Accounts, billing, or anything a paying customer would need

## 11. Schedule

Solo build with coding agents writing most of the code. No Lean experience. Times are Indian time.

| When | What must be true |
| --- | --- |
| Wednesday 11 Nov, night | NEAR AI key claimed, testnet parent account created |
| Thursday 12 Nov, night | The Attacker has reproduced the planted bug as a Finding. The Lean checkpoint is met, or the fallback is chosen. |
| Friday 13 Nov, night | One full recorded Audit of the vault: Conflict, Refinement, verdicts, Payouts. Plain replay works. No new features after this. |
| Saturday 14 Nov | README, licence, video, post. Should-haves if there is time. |
| Saturday 14 Nov, 22:00 | Submitted, seven and a half hours before the form closes |

**The Lean checkpoint.** By Thursday night the Prover's own loop has produced, at least once, a Lean-checked proof of Rule 1 against the first Formalization of the vault. A proof written by hand does not count.

**The fallback.** If the checkpoint is missed, Lean is dropped and not touched again. The Prover then runs randomised tests of the same Rules against the same Formalization, and every such result is labelled "checked, not proven". No Rule is called Proven. The Conflict still works, because the first Formalization still misses the bug.

If Friday's milestone slips, Payouts are the first job on Saturday and the fixed vault is dropped.

## 12. Boundaries

- The Attacker runs only against a local sandbox. It sends no transaction to mainnet or to anyone else's deployed contract.
- The only targets are the project's own vaults and contracts the user says they own.
- Findings come out as tests and a report for the contract's owner. No ready-to-use mainnet exploit scripts.
- Keys live in a local `.env` file that is never committed. The repository carries an example file with the names only.
- NearWatch does not read or borrow from fixseal's code (see section 13).

## 13. Facts checked on 11 Nov 2026

| Question | Answer |
| --- | --- |
| How crowded are the tracks? | 548 projects. Security 258, Agent Economy 248, Swarms 50. Counted from the site's own project list. |
| Does NEAR AI offer uncensored security models? | Yes, to any NEAR AI Cloud account. Two are listed, described as for red teaming and security research. |
| Is NEAR AI Red real? | Yes. An official program launched 29 Oct 2026. Joining is not needed to use the models. |
| Does NEAR have a Lean tool to call? | No. NEAR has published plans and one research harness for maths problems (`nearai/putnambench-deepseek`), which has no licence file, so its code is not reused. |
| How are contracts tested locally? | `near-workspaces` 0.24 runs on Apple Silicon and has an official failed-callback example. NEAR's docs now recommend `near-sandbox` with `near-api`. |
| Is anyone building the same thing? | Not found among the entries read. The nearest is `MorikiKamio/fixseal`, which decides whether to accept an AI-written patch to an agent's spending rules, using exploit replay and Lean. It does not audit contracts and is entered in Security and Open. |

Not confirmed: what the `isReady` flag on some models in the NEAR AI catalog means. Each chosen model should be called once before it is relied on.

## 14. Risks

1. **Time.** Three days, solo, for a vault, a sandbox harness, a proof loop, payouts, a recording and a write-up.
2. **Lean.** Still the riskiest part. There is no NEAR tool to lean on, the builder is new to Lean, and LLMs are known to stop before a proof is finished. The checkpoint and fallback in section 11 bound the damage.
3. **The Attacker may not find the planted bug unaided.** The bug-class list is the only help it is allowed.
4. **The Refinement proof.** Showing the proof fail after Refinement means the Prover must produce a counterexample or a clear failure for the refined Formalization, which is new Lean work on Friday.
5. **Two networks.** Exploits run in a local sandbox and Payouts run on testnet. Testnet can be slow or down.
6. **Reproducibility.** Anything the reviewing agents cannot run counts against the entry. Plain replay covers this.
7. **Looking staged.** The planted bug and the coarse first Formalization can read as a trick. The README's admissions and `docs/adr/0001` are the answer.
8. **A similar entry.** fixseal is polished and uses some of the same words. The pitch leads with what it lacks: finding the bugs, the Conflict, the Refinement and the Payouts.

## 15. Left for the build spec

These are details, to be settled in the spec without further questions: the exact Payout amounts, the wording of each agent's prompt, the contents of the bug-class list, how many attempts each agent gets, and the file layout.

## 16. Steps only the builder can do

- Join NEAR Builders and claim the $10 NEAR AI key.
- Create the testnet parent account.
- Have a mainnet NEAR account for the prize payout.
- Record the demo video and post it on X.
- Confirm the exact submission payload before it is sent.

## 17. What done looks like

- A public repository with a LICENSE and a README in "do X, see Y" form
- One command that replays the full Audit of the demo vault with no keys and no network
- One command that runs it live with a NEAR AI key and a testnet account
- The run shows a reproduced exploit, a proof that claimed otherwise, the Referee's Conflict, one Refinement, the verdicts and the Payouts
- A demo video showing that, in a post on X with the required tags
- Submitted once, by 22:00 Indian time on Saturday 14 Nov 2026

## Sources

- https://nearhackathon.com and https://nearhackathon.com/HACKATHON.md
- https://github.com/nearai/near-hackathon-prompt-examples (tracks 05 and 06)
- https://cloud-api.near.ai/v1/model/list and https://docs.near.ai/cloud/quickstart
- https://near.ai/blog/cybersecurity-models-and-near-ai-red-launch
- https://near.org/blog/formal-verification-101
- https://github.com/nearai/putnambench-deepseek
- https://docs.near.org/smart-contracts/testing/integration-test
- https://github.com/near/near-sdk-rs/blob/master/examples/fungible-token/tests/workspaces.rs
- https://github.com/MorikiKamio/fixseal
