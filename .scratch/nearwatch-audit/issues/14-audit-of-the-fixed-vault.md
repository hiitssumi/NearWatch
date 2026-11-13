# 14: Audit of the fixed vault

**What to build:** A live Audit of the fixed vault, to show what a clean result looks like beside the buggy one. Should-have. This is the first ticket dropped if time runs out.

**Blocked by:** 08

**Status:** resolved

- [x] A live Audit of the fixed vault ends with no Finding, except possibly the attached-NEAR one (NEAR attached to a call of a read-only method stays in the vault, credited to nobody), which is stated plainly as real NEAR behaviour, not the planted bug. The Attacker's other attempts appear as Leads.
- [x] Rule 2 ends Proven.
- [x] Rule 1 ends Proven or Unproven. Unproven is an accepted result and is stated plainly, with no extra effort spent forcing the proof.
- [x] No Conflict is reported.
- [x] The share of any Rule that ended Unproven returns to the payer.
- [x] The Recording is stored in the repository, and the replay command can be told to play it.
- [x] Fast test from that Recording: no Finding, no Conflict, Rule 2 Proven.

## Comments

12 Nov 2026, from ticket 05's live runs: both vaults keep NEAR attached to a call of the view method `balance_of` and credit it to nobody (near-sdk rejects attached deposits only on `&mut self` methods). The Attacker found this twice, under a Rule that the non-money methods "touch no money", and the Referee reproduced it. A live Audit of the fixed vault will likely end with that Finding. Before this ticket, decide: fix both vaults (for example, make the view methods reject an attached deposit, or remove them from the call surface), or accept the Finding and change the first criterion to "no Finding except the attached-deposit one".

13 Nov 2026: decided with the builder to accept it. Both vaults stay as they are: near-sdk rejects attached NEAR only on methods that change state, and a read-only method cannot check for it without breaking ordinary view calls. The first criterion now allows that one Finding.

**Done (13 Nov 2026).** The live Audit of the fixed vault (`recordings/live-fixed-vault.json`, $0.74, replay with `npm run replay -- recordings/live-fixed-vault.json`):
- **No Finding and no Conflict. Every Rule is Proven**: R1 (deposit credits exactly what arrives), R2 (withdraw: the transfer lands and the record loses that amount, or it fails and the record is put back whole), R3 (only the contract may call the withdrawal callback), R4 (only the owner may pause deposits), R5 (`new` cannot run twice). The spec's Rule 1 is R2 here and Rule 2 is R4.
- **The Attacker ran 21 Scenarios, and none made its Rule check true.** These include S10, a withdraw to a missing account, where the callback ran and put the balance back: the same Scenario that is a Finding on the buggy vault. All 21, and the 31 bug classes it skipped with a stated reason, are kept as Leads (52 in all).
- **The attached-NEAR issue did not come up.** This time the Rules agent wrote no Rule that the read-only methods touch no money. It is accepted either way (see the comment above).
- **No Rule ended Unproven, so no Rule's share returned to the payer.** Only the Reporter's 5% did, because the Reporter does not exist yet. Ticket 09's ledger tests cover an Unproven share returning.
- A fast test (`test/fixed-vault.test.ts`) replays the Recording: no Finding, no Conflict, every Rule Proven, 21 Scenario Leads, and nothing paid to the Attacker.
- The Recording's commit is `0dda640-dirty`. The only uncommitted change during the run was this ticket file.

Honest notes:
- **The first Formalization is still coarse** (`docs/adr/0001`): withdraw is one step. But this time the Rules agent gave that step the transfer's outcome (`transfer_ok`) and put the callback's restore inside it. So the R2 proof does cover a failed transfer, and Lean confirms the fixed vault's withdraw keeps the record whole in that case. On the buggy vault, a proof against the one-step model passed even though the real contract was broken. What tells the two vaults apart here is the Attacker's sandbox runs (S10), not the proofs alone.
- This run cost $0.74, against $1.70 for ticket 08. The Rules agent's Formalization used about 95,000 hidden reasoning tokens in one call, against 264,000 over three calls in ticket 08.
