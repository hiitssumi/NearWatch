# 01: Vaults with the planted bug

**What to build:** Two small vault contracts in Rust with near-sdk, a buggy one and a fixed copy, with sandbox tests that prove the planted bug is real before any agent looks for it. The spec's section "The demo vault" describes both.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Both vaults build to WebAssembly from one Rust workspace.
- [ ] Each vault has deposit, withdraw to a named receiver, a balance view, and an owner-only switch that pauses deposits.
- [ ] No owner method changes any user's balance.
- [ ] The buggy vault's withdraw reduces the caller's recorded balance and sends the money with an asynchronous transfer, and nothing restores the balance when that transfer fails.
- [ ] The fixed vault restores the balance in a callback when the transfer fails.
- [ ] Sandbox test, both vaults: deposit then withdraw to an existing account returns the money and clears the balance.
- [ ] Sandbox test: a withdrawal to an account that does not exist leaves the recorded balance reduced on the buggy vault and restored on the fixed vault.
- [ ] Sandbox test, both vaults: only the owner can pause deposits, and pausing changes no balance.
- [ ] Tests use near-workspaces 0.24, as `docs/adr/0002` requires.
- [ ] Any NEAR build tool this needs is installed, and the install steps are written down for ticket 12's README.
- [ ] All vault tests run with one command.
