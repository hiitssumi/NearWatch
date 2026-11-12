# 14: Audit of the fixed vault

**What to build:** A live Audit of the fixed vault, to show what a clean result looks like beside the buggy one. Should-have. This is the first ticket dropped if time runs out.

**Blocked by:** 08

**Status:** ready-for-agent

- [ ] A live Audit of the fixed vault ends with no Finding. The Attacker's attempts appear as Leads.
- [ ] Rule 2 ends Proven.
- [ ] Rule 1 ends Proven or Unproven. Unproven is an accepted result and is stated plainly, with no extra effort spent forcing the proof.
- [ ] No Conflict is reported.
- [ ] The share of any Rule that ended Unproven returns to the payer.
- [ ] The Recording is stored in the repository, and the replay command can be told to play it.
- [ ] Fast test from that Recording: no Finding, no Conflict, Rule 2 Proven.

## Comments

12 Nov 2026, from ticket 05's live runs: both vaults keep NEAR attached to a call of the view method `balance_of` and credit it to nobody (near-sdk rejects attached deposits only on `&mut self` methods). The Attacker found this twice, under a Rule that the non-money methods "touch no money", and the Referee reproduced it. A live Audit of the fixed vault will likely end with that Finding. Before this ticket, decide: fix both vaults (for example, make the view methods reject an attached deposit, or remove them from the call surface), or accept the Finding and change the first criterion to "no Finding except the attached-deposit one".
