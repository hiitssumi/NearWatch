# BRIEF: NearWatch, a swarm of agents that audits NEAR smart contracts

Status: idea, not yet grilled. Written 11 Nov 2026. Project name: NearWatch.

## How to use this brief

This is the input to a grilling session, and after that to a build spec. Nothing here is final except the hackathon facts in section 2.

If you are the one grilling: work through the open questions in section 11 in order, one at a time. They are sorted by how much of the plan each answer changes. Push hardest on scope, because the deadline is about three days away and the builder is solo.

## 1. The idea in one paragraph

A team pastes in a NEAR smart contract. Six agents audit it together: one maps where the money flows, one tries to break the contract in a sandbox, one writes down the rules the contract should obey, one tries to prove those rules in Lean, one cross-checks the others, and one writes a plain-English report. The point of having several agents is that they check each other. When the attacker reproduces a bug that a proof says cannot happen, the proof is wrong, and the judge sends it back.

## 2. Hackathon facts

Checked against nearhackathon.com and its HACKATHON.md on 11 Nov 2026. Re-read HACKATHON.md before submitting, because the organizers say dates and rules may change.

| Fact | Value |
| --- | --- |
| Submission deadline | 14 Nov 2026, 23:59 UTC. The earlier notes said 15 Nov; that is wrong. |
| Judging | 16–18 Nov 2026 |
| Prizes per track | $10K, $3K, $2K. One $55K grand prize overall. |
| Tracks | 13. One submission can list every track it fits. |
| What to submit | A public repository, a public demo post on X (video or screenshots, tagged @NEARProtocol and #NEARHackathon), and a 20–2,000 character description |
| First-pass judging | Claude Code and Codex screen every project: they check that it can be reproduced and that the claimed features exist. Humans decide. |
| README | Must be written as "do X, see Y" steps a judge can follow. No marketing. |
| Local-only demo | Allowed, if the repository is public, the README reproduces it, and the X post has a video |
| Testnet-only | Allowed in all tracks |
| Required integrations | None. Track hints are hints. |
| NEAR Intents | Mainnet only. There is no testnet. |
| NEAR AI credits | $10 free through NEAR Builders, or buy at cloud.near.ai |
| Submissions | One attempt per repository. Mistakes are fixed by a change request, not a resubmit. |

## 3. Who it is for and why

Teams about to deploy a contract on NEAR that holds money. A human audit is slow and expensive, and a single AI scan produces findings nobody can trust. This gives them a report where each finding is either reproduced by a runnable exploit or backed by a proof, and where the two kinds of evidence have been checked against each other.

## 4. The agents

| Agent | Job | Output |
| --- | --- | --- |
| Scout | Reads the contract. Maps where money enters, sits and leaves. Flags whether anyone can still change the contract (upgrade paths, full-access keys, owner-only methods). | Money-flow map, list of privileged actions |
| Attacker | Tries to break the contract in a local sandbox. Keeps only what it can reproduce. | Runnable exploit tests, one per finding |
| Rules | Turns the money flows into the rules worth proving, such as "after a deposit, the depositor can always withdraw" and "the admin cannot take user funds". | Rules in plain English and in Lean |
| Prover | Tries to prove each rule in Lean. Records what each proof cost in tokens, dollars and time. | Proof, or a failed attempt, with cost |
| Judge | Cross-checks the others. A reproduced exploit that contradicts a passing proof means the proof, or the model it was proved against, is wrong. Sends it back. | Verdict per finding and per rule, list of disagreements |
| Reporter | Writes the report for the team that asked. | Plain-English report |

## 5. The demo moment

The Judge catches the Attacker and the Prover disagreeing.

To make this happen reliably on camera, the demo contract needs a bug planted in it that the first Lean model misses. A candidate, not yet decided: a small vault with deposit and withdraw, where a withdrawal sends funds through an asynchronous call and does not restore the balance if that call fails. This is a bug class specific to NEAR. A first Lean model that treats withdrawal as one atomic step will happily prove "deposit, then always able to withdraw". The Attacker reproduces the loss in the sandbox. The Judge sees both, rejects the proof, and sends the model back to be fixed.

This also gives the project its honest claim: a proof only covers the model it was written against, and the swarm exists to catch the cases where the model and the real contract differ.

## 6. Track fit

The plan is to enter AI Swarms and AI Security & Defense together, since one submission can list several tracks. Neither fit is clean, and this needs grilling.

**AI Swarms.** The track text asks for "coordination markets, bidding, collective purchasing, intent-based settlement and emergent economies between agents", and hints at NEAR Intents and sub-accounts. Its example prompt gives each agent its own sub-account so every action on chain traces to one agent. A chain of agents passing work along is a pipeline, not an economy. To fit, the agents probably need money moving between them. One option: the team pays an audit fee, each agent has a sub-account, the Attacker earns per reproduced finding, the Prover earns per proof that survives the Judge, and the Judge withholds payment for work it rejects.

**AI Security & Defense.** The track text is about protecting agents that hold money: "spending limits, policy engines, sandboxed wallets, reputation and scam detection". Auditing contracts is security work, but it is not what the track describes. The closest honest link is that agents need to know a contract is safe before sending money to it.

**Agent Economy** may also fit if the audit is sold as a paid job, for example by listing it on Agent Market.

## 7. Scope

Sorted by what gets cut first if time runs out. Cut from the bottom.

**Must have**
- One demo contract, written for this project, with one planted bug
- Scout, Attacker and Judge working end to end on that contract
- The Attacker's exploit runs as a test anyone can re-run
- The disagreement moment from section 5, visible in the output
- A replay mode that reproduces the full run without calling any model, so the AI judges and human judges can run it without keys or credits
- README in "do X, see Y" form, public repository, demo video, X post

**Should have**
- Rules and Prover agents with one or two real Lean proofs on the demo contract
- Cost logged per proof
- Reporter producing the plain-English report
- A page that shows the run as it happens

**Stretch**
- A sub-account per agent, and payment between agents
- Paying for an audit through NEAR Intents (mainnet only, so real money and tiny amounts)
- Running on a contract the swarm has not seen before
- Listing on Agent Market

**If the proofs stall:** the scan and attack agents carry the demo. The disagreement moment then needs a stand-in for the Prover. Options: proofs written by hand ahead of time for the demo contract, or property tests in place of proofs, labelled as "checked, not proven". Decide this fallback before building, not on the last day.

## 8. Boundaries

- The Attacker only runs against contracts in a local sandbox. It sends no transactions to mainnet or to anyone else's deployed contract.
- The only targets are the project's own demo contracts and contracts the user says they own.
- Findings come out as tests and a report for the contract's owner. No ready-to-use mainnet exploit scripts.
- No keys in the repository.
- Present this as tooling built on NEAR AI's models, in support of NEAR's own security work. It is not a competitor to NEAR AI Red.

## 9. Claims not yet verified

The earlier notes state these as facts. I could not confirm them from an official source. Each one needs checking before the build spec depends on it.

| Claim | What I found | If false |
| --- | --- | --- |
| NEAR has a cheap Lean tool that the Prover can call | NEAR AI has announced plans for AI-assisted formal verification and reported results on a maths benchmark in Lean. I found no released tool for proving things about contracts. | The Prover is a general model writing Lean in a loop against a local Lean install. Slower, and the "cheap" claim needs its own evidence. |
| NEAR AI offers a private uncensored model for security work | One third-party blog describes this and says it is open to any NEAR AI Cloud account. The official catalog was not checked. | The Attacker runs on whatever NEAR AI Cloud model is best at code. Sandbox-only testing of your own contract is unlikely to be refused by an ordinary model. |
| NEAR AI Red is NEAR's security program | Same single third-party blog. No official page found. | Drop the reference from the pitch. |
| AI Swarms is the least crowded track that fits | Not checked. The site has a public list of submissions that can be filtered by track. | Changes which track leads the pitch. |

## 10. Risks

1. **Time.** About three days, solo, for six agents, a contract, a sandbox harness, Lean, a demo video and a write-up.
2. **Lean.** The riskiest part. Proving anything about real Rust or WASM contract code is out of reach in this window. Proofs will be against a hand-written or model-written Lean model of the contract, which is a weaker claim.
3. **Track fit.** See section 6. A project that fits neither track well can lose to a simpler one that fits exactly.
4. **Reproducibility.** Judges screen with AI agents that try to run the project. Anything that needs paid keys, mainnet funds or a long setup will fail that screen. The replay mode exists to cover this.
5. **A staged demo.** A planted bug on a hand-picked contract can look like a trick. The README has to say plainly what is planted and what the swarm found unaided.
6. **Model cost and refusals.** $10 of free credits may not cover development. The Attacker's prompts may be refused by some models.

## 11. Open questions, in order

1. **Is six agents the right scope for three days?** What is the smallest set that still produces the disagreement moment?
2. **What does "proved" mean here?** Proved against a Lean model of the contract, written by whom, and how does anyone know the model matches the code?
3. **What replaces the Prover if Lean stalls,** and at what point is that call made?
4. **What is the demo contract and the planted bug?** Is the candidate in section 5 right? Can the Attacker find it unaided, or is it scripted?
5. **Is this a swarm or a pipeline?** Does money move between agents, and if so, how, on testnet or mainnet?
6. **Which track leads the pitch?** Swarms, Security, or Agent Economy?
7. **What do the agents run on?** Which NEAR AI Cloud models, called through which framework, in which language?
8. **What does the sandbox harness look like?** How does the Attacker deploy, call and observe the contract, and how does a finding become a re-runnable test?
9. **How does the Judge decide?** By rules in code, by a model, or both? What exactly counts as a disagreement?
10. **What does the user see?** A command-line run, a web page, or both? What is on screen in the demo video?
11. **How does the replay mode work?** Recorded model outputs, or scripted agents?
12. **Does payment through Intents make the cut,** given it is mainnet only?
13. **What is NEAR's concrete role?** The demo post is expected to say what NEAR makes possible in this product, in specific terms.
14. **About the builder:** how much Lean, Rust and NEAR experience, how many hours a day until the deadline, and is anyone else helping?

## 12. What done looks like

- A public repository with a LICENSE and a README in "do X, see Y" form
- One command that replays the full audit of the demo contract with no keys
- One command that runs it live with a NEAR AI key
- The run shows a reproduced exploit, a proof that claimed otherwise, and the Judge rejecting the proof
- The README says what is planted, what is real, and what the proofs do and do not cover
- A demo video showing that moment, in a post on X with the required tags
- Submitted once, before 14 Nov 2026, 23:59 UTC, after the human has confirmed the exact payload

## 13. Out of scope

- Proving properties of real Rust or WASM code directly
- Auditing arbitrary contracts with any promise of coverage
- Any attack on a contract outside a local sandbox
- Accounts, billing, or anything a paying customer would need

## Sources

- https://nearhackathon.com
- https://nearhackathon.com/HACKATHON.md
- https://github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/05-swarms.md
- https://github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/06-security.md
- https://crypto.news/near-ai-formal-verification-protocol-smart-contracts/
- https://www.remio.ai/post/near-ai-red-opens-for-security-teams-with-private-uncensored-models
