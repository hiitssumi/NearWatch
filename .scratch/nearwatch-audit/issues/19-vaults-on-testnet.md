# 19: Both vaults deployed on NEAR testnet

**What to build:** The buggy and the fixed vault deployed on NEAR testnet, where anyone can look at them on an explorer, with the planted bug shown there by real calls. The Attacker keeps running Scenarios in the local sandbox, so Audits, replay and replay with verification are unchanged.

**Blocked by:** 10

**Status:** resolved

- [x] One command builds both vaults and deploys each to its own account under the parent account on testnet, initialized with the parent as owner. Run again, it leaves code that is already deployed alone and replaces code that has changed.
- [x] The same command deposits into each vault, then withdraws to an account that does not exist, and prints each transaction's hash, whether the transfer failed, and the depositor's recorded balance before and after the withdrawal.
- [x] On the buggy vault the balance is lost; on the fixed vault it is restored.
- [x] It refuses a parent account that is not a testnet account, and an RPC that is not on testnet, before sending anything.
- [x] What it did is written to a file in the repository, and the README links each account and transaction.
- [x] Tested on a local NEAR node; nothing in the test suite touches testnet.

## Comments

**Resolved (14 Nov 2026).** Asked for by the builder: "Do all the deployments and tests on testnet", narrowed to deploying the vaults (moving the Attacker's Scenarios to testnet was declined: slow, not repeatable, and it would break replay with verification).
- `npm run deploy-vaults`: `src/near/deploy.ts` and `src/cli/deploy-vaults.ts`. Two new actions in the hand-signed transactions (deploy contract, function call), and two new RPC calls (a contract view, a block's height).
- Reads after a transaction name the block it ran in. The testnet RPC spreads calls over several nodes, and the first live run read a stale "before" balance on the fixed vault (0 instead of 0.1). That run's hashes are on chain but not in the README.
- Live on testnet: `buggy-vault.nearwatch-demo.testnet` and `fixed-vault.nearwatch-demo.testnet`, 1.5 NEAR each. On the buggy vault the withdrawal's transfer failed with `AccountDoesNotExist` and the ledger dropped from 0.1 to 0 NEAR; on the fixed vault the same failure returned `false` and the ledger stayed at 0.2 NEAR (0.1 left from the first run). Checked separately through an archival RPC.
- Tests: `test/deploy.test.ts` (the byte layout of both actions, the testnet-only guard) and `test/deploy.slow.test.ts` (deploy, unchanged redeploy, code update, the bug and its fix, and refusal of a node not on testnet, on a local sandbox node).
- README step 4, "See both vaults on NEAR testnet". Replay with verification is now step 5 and the live Audit step 6.
