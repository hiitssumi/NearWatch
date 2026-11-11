# 02: Run a Scenario in the sandbox

**What to build:** A fixed sandbox harness that takes a compiled contract, a Scenario and a Rule check, all as data, runs the Scenario in a local sandbox, and reports what it observed and whether the Rule check came out true. The TypeScript program reaches it through the toolchain's "run a Scenario" operation. See the spec's section "Scenarios are data, not code".

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] A Scenario is an ordered list of these actions only: create a named account with a balance, call a contract method as a given account with arguments, attached deposit and gas, and read a view method.
- [ ] An action may name an account that does not exist.
- [ ] The harness records, before and after the Scenario: the results of named view calls, account balances, and which receipts failed.
- [ ] A Rule check is a comparison over those observations. The harness evaluates it, not the caller.
- [ ] A hand-written Scenario (deposit, then withdraw to an account that does not exist) with Rule 1's Rule check comes out true on the buggy vault and false on the fixed vault.
- [ ] The harness is compiled once. Running a second Scenario does not recompile it.
- [ ] A malformed Scenario or an unknown action is reported as an error that names the problem, not a crash.
- [ ] The harness talks only to the local sandbox. It has no way to send a transaction anywhere else.
- [ ] The toolchain's operation returns a typed result to the TypeScript program, and a slow test covers the hand-written Scenario on both vaults.
