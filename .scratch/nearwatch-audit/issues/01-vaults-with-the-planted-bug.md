# 01: Vaults with the planted bug

**What to build:** Two small vault contracts in Rust with near-sdk, a buggy one and a fixed copy, with sandbox tests that prove the planted bug is real before any agent looks for it. The spec's section "The demo vault" describes both.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] Both vaults build to WebAssembly from one Rust workspace.
- [x] Each vault has deposit, withdraw to a named receiver, a balance view, and an owner-only switch that pauses deposits.
- [x] No owner method changes any user's balance.
- [x] The buggy vault's withdraw reduces the caller's recorded balance and sends the money with an asynchronous transfer, and nothing restores the balance when that transfer fails.
- [x] The fixed vault restores the balance in a callback when the transfer fails.
- [x] Sandbox test, both vaults: deposit then withdraw to an existing account returns the money and clears the balance.
- [x] Sandbox test: a withdrawal to an account that does not exist leaves the recorded balance reduced on the buggy vault and restored on the fixed vault.
- [x] Sandbox test, both vaults: only the owner can pause deposits, and pausing changes no balance.
- [x] Tests use near-workspaces 0.24, as `docs/adr/0002` requires.
- [x] Any NEAR build tool this needs is installed, and the install steps are written down for ticket 12's README.
- [x] All vault tests run with one command.

## Comments

Done. Workspace at `rust/` (members `vaults/buggy`, `vaults/fixed`, `vaults/tests`; `default-members` is the test crate, so ticket 02 should add the harness to both lists). Install steps for ticket 12's README are in `rust/README.md` (rustup + `wasm32-unknown-unknown`, cargo-near 0.23.0 via its official installer). Toolchain: Rust 1.99.1, near-sdk 5.30, near-workspaces 0.24.0 with the `unstable` feature for `compile_project`.

```bash
source "$HOME/.cargo/env"
cd rust && cargo test        # builds both vaults to wasm, runs all 6 sandbox tests
cd rust/vaults/buggy && cargo near build non-reproducible-wasm   # -> rust/target/near/vault_buggy/vault_buggy.wasm
cd rust/vaults/fixed && cargo near build non-reproducible-wasm   # -> rust/target/near/vault_fixed/vault_fixed.wasm
```

Vault methods: `new(owner)`, `deposit()` (payable), `withdraw(amount, receiver_id)`, `balance_of(account_id)`, `set_deposits_paused(paused)` (owner only), `deposits_paused()`, `owner()`; the fixed vault adds the private callback `on_withdraw_complete`. Amounts are yoctoNEAR strings. In the failed-transfer test the receiver is `ghost.<root>` (does not exist): the buggy vault leaves alice at 2 of 5 NEAR after withdrawing 3, the fixed vault restores 5, and both report the failed receipt via `receipt_failures()`.

12 Nov: ticket 04's live run showed the vaults' top-of-file comments naming the planted bug reached the Scout. Both `src/lib.rs` files now open with the same neutral description; the planted-bug and fixed-copy wording lives only in `rust/README.md` and the tests. Still visible to an agent that sees paths or `Cargo.toml`: the crate names `vault-buggy`/`vault-fixed` and the `vaults/buggy` directory.
Ticket 04 confirmed (12 Nov) that agent prompts hold only the `src/**.rs` text, so the crate and folder names stay as they are. Ticket 05 must keep the contract path and crate name out of the Attacker's prompt.
