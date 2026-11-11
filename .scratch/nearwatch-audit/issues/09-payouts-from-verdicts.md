# 09: Payouts from verdicts

**What to build:** At the end of an Audit the transcript shows each agent's Payout, worked out from the verdicts and sent to a fake payer that only records what it would send. See the spec's section "Payment".

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] The Fee is 1 testnet NEAR per Audit.
- [ ] Flat shares: Scout 5%, Rules agent 10%, Reporter 5%, Referee 20%.
- [ ] The remaining 60% is split evenly across the Rules. A Rule's share goes to the Attacker if the Rule ended Broken, to the Prover if it ended Proven, and back to the payer if it ended Unproven.
- [ ] The share of an agent that did not run goes back to the payer.
- [ ] Payouts and returns add up to the Fee exactly, with nothing lost to rounding.
- [ ] The Referee's Payout is the same whatever the verdicts are.
- [ ] The calculation is separate from sending. The fake payer records each Payout it would send.
- [ ] The transcript shows each Payout with its reason, and says plainly that the payments are simulated.
- [ ] With no testnet account in settings, an Audit uses the fake payer.
- [ ] Fast tests at the Audit seam cover each rule above.
