# Submission drafts (ticket 13)

Drafts for the builder to edit. The builder records the video, publishes the post and confirms the submission. Nothing here holds personal data; the submission payload itself is not kept in the repository.

Checked on 14 Nov 2026 against the live https://nearhackathon.com/HACKATHON.md: the deadline is still 2026-11-14T23:59:00Z (05:29 on Sunday 15 Nov, Indian time), one submission per repository, mistakes fixed by a change request. The repository is public, `main` is its default branch and holds everything, and GitHub shows the MIT licence.

## 1. Video script (about 1 minute 50 seconds)

A recording of the terminal, from the repository folder. Make the window wide (at least 170 columns) and the font large enough to read. `npm run replay` prints the same 220 lines every time, so each command below shows one part of it. Speak the lines, or put them on screen as captions.

| Time | Type this | Say this |
| --- | --- | --- |
| 0:00 | (nothing yet) | "An AI audit of a smart contract gives you claims you can't check. NearWatch makes its agents back every claim with evidence, and catches them when their evidence disagrees." |
| 0:10 | `npm run --silent replay \| sed -n '4,25p' \| cut -c1-170` | "This replays one real Audit of a small NEAR vault. Six agents. The Fee, one testnet NEAR, is collected first. The Scout maps the money. The Rules agent writes five Rules. R2 says a withdraw must only take what the receiver actually gets." |
| 0:35 | `npm run --silent replay \| sed -n '129,160p' \| cut -c1-170` | "The Attacker withdrew to an account that doesn't exist. The transfer failed, and alice's balance still dropped to zero. The Referee re-ran it: a Finding. But the Prover also proved R2 in Lean, and the Referee accepted that proof. Both can't be right. That's a Conflict. The Finding wins, and the Prover's pay for this Rule passes to the Attacker." |
| 1:05 | `npm run --silent replay \| sed -n '161,190p' \| cut -c1-170` | "The proof was true of a description of the contract that was too simple: it treated withdraw as one step. So the description is refined, and the old proof no longer passes. Then the Prover finds a counterexample that Lean confirms, on the same path the Attacker took. Now they agree on why the Rule is broken." |
| 1:30 | `npm run --silent replay \| sed -n '191,220p' \| cut -c1-170` | "Verdicts: withdraw is Broken, the other four Rules are Proven. And the Payouts: every agent is a NEAR account, paid on testnet. Each line is a real transaction." |
| 1:42 | Open `https://testnet.nearblocks.io/txns/GvHZ9QoWvWjkJPctWg18HSiiyY8s2GeVmEhrzwmCXvkk` in a browser | "This is the Attacker being paid the share the Prover lost. On NEAR, agents are accounts, so they can be paid for evidence that survives, not for claims." |
| 1:50 | (end) | |

Say once, early or in the post: the vault was written for this project and its bug was planted.

## 2. Post on X

The main post, 279 characters as X counts it (any link counts as 23; the limit is 280):

```
A Lean proof said this NEAR vault's withdraw can't lose money. A sandbox attack lost it anyway.

NearWatch: 6 AI agents audit a NEAR contract. A referee re-runs their evidence and catches the conflict.

Built at NEAR HACKATHON @NEARProtocol #NEARHackathon
https://github.com/hiitssumi/NearWatch
```

Attach the video. A reply under it, 270 characters:

```
Each agent is a NEAR testnet account, paid from a fixed Fee only for evidence the referee could reproduce. When the attack beat the proof, the Prover's share went to the Attacker.

The vault and its bug were planted for the demo. What should it audit next? @NearBuilders
```

## 3. Submission description ("idea", 20 to 2,000 characters)

1,665 characters:

```
Problem: a team about to deploy a NEAR contract that holds money gets either a slow human audit or a single AI scan whose claims nobody can check.

NearWatch audits a NEAR contract (Rust, near-sdk) with six agents whose evidence is checked against each other. A Scout maps where money moves. A Rules agent writes the Rules the contract should obey. An Attacker tries to break each Rule in a local NEAR sandbox. A Prover tries to prove each Rule in Lean 4. A Referee, which is ordinary code, re-runs every attack and re-checks every proof. A Reporter writes the result in plain English.

The central moment is a Conflict: the Attacker reproduces an exploit against a Rule the Prover has proved. The exploit wins, because the proof was only about a simplified description of the contract. That description is then refined, the old proof fails against it, and the Prover finds a Lean-checked counterexample on the same path as the attack.

How NEAR fits: the target is a NEAR contract and the Attacker looks for NEAR-specific bug classes, such as state not restored when an async transfer fails. Every agent is a NEAR testnet sub-account. A fixed Fee is split by plain transfers according to whose evidence survived the Referee, so when the attack beat the proof, the Prover's share went to the Attacker. The Attacker runs on NEAR AI's uncensored security model, and all LLM calls go through NEAR AI Cloud.

Honest limits: the demo vault and its bug were planted for this project, a proof covers the Lean description and not the Rust code, and results are promised for the demo vault only. `npm run replay` shows the whole Audit with only Node, no keys and no network.
```

## 4. Submission fields

Already settled by the ticket and the repository: project name `NearWatch`, team size `1`, tracks `swarms` and `security`, repository `https://github.com/hiitssumi/NearWatch`.

The builder decides and gives these; an agent must not guess or invent them:

- Team lead's name
- Contact email
- Mainnet NEAR account for the prize payout (the builder creates it in a NEAR wallet)
- The link to the published post on X
- Whether to add a third track. `agents` (Agent Economy: agents that earn and get paid) also fits.
- Consent to the contact notice, read verbatim: "I agree that the organizers may use these details to review our submission and contact us about this hackathon."

The exact payload is printed for the builder and sent only after a yes. It can be sent once: a second submission of the same repository is rejected.
