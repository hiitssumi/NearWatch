# 10: Testnet accounts and real Payouts

**What to build:** A setup command creates a NEAR testnet account for each agent, and an Audit pays its Payouts in real testnet transactions, printing each transaction hash. At a Conflict the transcript shows the Prover's share of that Rule passing to the Attacker.

**Blocked by:** 08, 09

**Status:** needs-info

Needs from the builder: a testnet parent account holding enough testnet NEAR, with its key in the local settings file.

- [x] The setup command creates one sub-account for each agent and one for the payer, all under the builder's parent account. Running it twice does no harm.
- [x] The Fee moves from the payer to the parent at the start of an Audit. Payouts move from the parent to the agents at the end. Anything left returns to the payer.
- [x] All payments are plain transfers. No payment contract is written.
- [x] The transcript prints the transaction hash of each payment.
- [x] The hashes are stored in the Recording, and the replay payer returns them.
- [x] At the moment of a Conflict the transcript shows the Prover's claim on that Rule's share being cancelled and passing to the Attacker.
- [x] A failed transfer gives a clear message and lists what was not paid. The verdicts and the Audit's folder are still saved, and the Audit does not crash.
- [x] The parent account's key is read from the local settings file. It is never printed and never committed.
- [x] Payments are sent on testnet only. The payer refuses any other network.
- [ ] A live Audit of the buggy vault pays out on testnet, and each hash can be found on a testnet explorer.

## Comments

**Built (14 Nov 2026); the live testnet run is waiting on the builder.** Everything is built and tested except the last criterion, a live Audit of the buggy vault paying out on testnet. That needs `parentAccount` (a `.testnet` account holding about 3 testnet NEAR) and `parentKey` in `settings.local.json`, then `npm run setup-accounts` and `npm run audit -- rust/vaults/buggy`.

What stands in for testnet until then: **the real payer, run against a real NEAR node.** `test/payments.slow.test.ts` starts the local sandbox node (the same nearcore binary the Rust harness uses) and runs the real code against it over JSON-RPC:
- setup creates the payer's and all six agents' accounts under the parent, each with the parent's key, and a second run changes nothing;
- the Fee moves from the payer to the parent, Payouts move from the parent to an agent and back to the payer, and the balances come out right;
- the node knows each transaction by the hash the payer returned;
- a payer short of the Fee, and a payer made for testnet pointed at this node, send nothing and say why.

The only thing this does not cover is testnet itself: its RPC, and the builder's account and key.

Decisions:
- **No NEAR package.** Transactions are serialized (Borsh) and signed with Node's own ed25519 in `src/near/`. The program still has no runtime dependencies, so a fresh clone replays with only Node. The encoding matches near-api-js's own "serialize transfer tx" test vector byte for byte.
- **One key.** Each sub-account is created with the parent's key, so the key in settings signs for the parent and the payer. Agents' accounts only receive.
- **The Fee comes first.** If it cannot be collected, no agent runs and nothing is spent.
- **Testnet only, checked twice.** A parent account not ending in `.testnet` makes no payer at all, and the payer asks the RPC node for its network before its first transaction.
- **Recording.** The Fee's hash and each Payout's hash (or the reason it was not paid) are stored only for a real payer. The replay payer returns them and sends nothing. Recordings made with the fake payer are unchanged and replay as before.

A bug the real node caught, which no stand-in would have: reading the key's nonce from the last *final* block reuses a nonce when two payments follow each other, because a final block lags a transaction that has just run. Queries now read the latest block, and the last nonce per signer is remembered.

What was built:
- `src/near/keys.ts` (base58, reading a secret key in both forms NEAR writes, signing), `src/near/transaction.ts` (create account, transfer, add full-access key), `src/near/rpc.ts` (network, account, access key, send).
- `src/near/payments.ts`: `NearPayments` (the Fee, a Payout, setup) and `testnetPayer(settings)`, the only way the commands make a real payer.
- `src/cli/setup-accounts.ts` and `npm run setup-accounts`.
- `Payer` gains `collectFee`; `PaymentError`. The Audit runner collects the Fee first, prints each hash, and lists failed Payouts without stopping. `AuditResult.fee`; a Payout's `hash` is null with an `error` when it was not paid.
- `RecordingPayer`, `ReplayPayer`, `Recording.fee`, and `payouts.json` in the Audit's folder. Settings gain `testnetRpc` (default `https://rpc.testnet.fastnear.com`).
- `test/payments.test.ts` (fast, no network): the encoding vector; keys, and that no error shows a key; the testnet-only guards; an Audit that pays (hashes printed, stored, replayed, and a mismatched Recording failing clearly); a failed Payout; a Fee that cannot be collected; the fake payer.
