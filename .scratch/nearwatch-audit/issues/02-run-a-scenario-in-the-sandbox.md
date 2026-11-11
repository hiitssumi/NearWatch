# 02: Run a Scenario in the sandbox

**What to build:** A fixed sandbox harness that takes a compiled contract, a Scenario and a Rule check, all as data, runs the Scenario in a local sandbox, and reports what it observed and whether the Rule check came out true. The TypeScript program reaches it through the toolchain's "run a Scenario" operation. See the spec's section "Scenarios are data, not code".

**Blocked by:** 01

**Status:** resolved

- [x] A Scenario is an ordered list of these actions only: create a named account with a balance, call a contract method as a given account with arguments, attached deposit and gas, and read a view method.
- [x] An action may name an account that does not exist.
- [x] The harness records, before and after the Scenario: the results of named view calls, account balances, and which receipts failed.
- [x] A Rule check is a comparison over those observations. The harness evaluates it, not the caller.
- [x] A hand-written Scenario (deposit, then withdraw to an account that does not exist) with Rule 1's Rule check comes out true on the buggy vault and false on the fixed vault.
- [x] The harness is compiled once. Running a second Scenario does not recompile it.
- [x] A malformed Scenario or an unknown action is reported as an error that names the problem, not a crash.
- [x] The harness talks only to the local sandbox. It has no way to send a transaction anywhere else.
- [x] The toolchain's operation returns a typed result to the TypeScript program, and a slow test covers the hand-written Scenario on both vaults.

## Comments

Done (12 Nov).

- **Rust:** `rust/harness` (binary `nearwatch-harness`, member and default member of the `rust/` workspace). It reads one JSON request on stdin and writes one JSON line. The format, setup, account naming and the macOS `liblzma` note are in `rust/README.md`.
- **TypeScript:** `src/sandbox.ts`, `LocalSandbox.runScenario(contractPath, scenario, check)`. It builds the harness once per process (`cargo build --release`) and each contract crate once per process (`cargo near build non-reproducible-wasm`). It returns a `ScenarioOutcome` validated with `schemas.scenarioOutcome`, and throws `SandboxError` (`kind` `"invalid"` or `"internal"`) otherwise. `contractPath` may be a crate folder or a `.rs` file inside one.
- **Referee:** `src/referee.ts` now catches a `runScenario` error and keeps that Scenario as a Lead ("could not be run: ..."), so a malformed Scenario never crashes an Audit.
- **Not wired yet:** the live Audit (`src/live-audit.ts` `NO_TOOLCHAIN`). Ticket 05 should use `runScenario: (p, s, c) => new LocalSandbox().runScenario(p, s, c)`. The Attacker's prompt must state the setup: contract account `vault`, `owner` exists and is the owner, and new accounts are top-level names created by a `createAccount` action.
- **Before/after timing:** `before` is taken after the opening `createAccount` actions, as `src/domain.ts` says.

```bash
node --test test/sandbox.slow.test.ts      # 5 slow tests, about 20 s once built (also part of npm test; skipped without cargo)
cd rust && cargo test                      # harness unit tests + vault tests
cd rust && cargo build --release -p nearwatch-harness && ./target/release/nearwatch-harness < request.json
```
