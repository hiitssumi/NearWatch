# 10: Testnet accounts and real Payouts

**What to build:** A setup command creates a NEAR testnet account for each agent, and an Audit pays its Payouts in real testnet transactions, printing each transaction hash. At a Conflict the transcript shows the Prover's share of that Rule passing to the Attacker.

**Blocked by:** 08, 09

**Status:** ready-for-agent

Needs from the builder: a testnet parent account holding enough testnet NEAR, with its key in the local settings file.

- [ ] The setup command creates one sub-account for each agent and one for the payer, all under the builder's parent account. Running it twice does no harm.
- [ ] The Fee moves from the payer to the parent at the start of an Audit. Payouts move from the parent to the agents at the end. Anything left returns to the payer.
- [ ] All payments are plain transfers. No payment contract is written.
- [ ] The transcript prints the transaction hash of each payment.
- [ ] The hashes are stored in the Recording, and the replay payer returns them.
- [ ] At the moment of a Conflict the transcript shows the Prover's claim on that Rule's share being cancelled and passing to the Attacker.
- [ ] A failed transfer gives a clear message and lists what was not paid. The verdicts and the Audit's folder are still saved, and the Audit does not crash.
- [ ] The parent account's key is read from the local settings file. It is never printed and never committed.
- [ ] Payments are sent on testnet only. The payer refuses any other network.
- [ ] A live Audit of the buggy vault pays out on testnet, and each hash can be found on a testnet explorer.
