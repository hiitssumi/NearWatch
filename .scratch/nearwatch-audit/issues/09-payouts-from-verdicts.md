# 09: Payouts from verdicts

**What to build:** At the end of an Audit the transcript shows each agent's Payout, worked out from the verdicts and sent to a fake payer that only records what it would send. See the spec's section "Payment".

**Blocked by:** 03

**Status:** resolved

- [x] The Fee is 1 testnet NEAR per Audit.
- [x] Flat shares: Scout 5%, Rules agent 10%, Reporter 5%, Referee 20%.
- [x] The remaining 60% is split evenly across the Rules. A Rule's share goes to the Attacker if the Rule ended Broken, to the Prover if it ended Proven, and back to the payer if it ended Unproven.
- [x] The share of an agent that did not run goes back to the payer.
- [x] Payouts and returns add up to the Fee exactly, with nothing lost to rounding.
- [x] The Referee's Payout is the same whatever the verdicts are.
- [x] The calculation is separate from sending. The fake payer records each Payout it would send.
- [x] The transcript shows each Payout with its reason, and says plainly that the payments are simulated.
- [x] With no testnet account in settings, an Audit uses the fake payer.
- [x] Fast tests at the Audit seam cover each rule above.

## Comments

**Done (11 Nov 2026).** `npm test` (16 pass), `npm run typecheck`, `npm run replay` shows the `== Payouts ==` block.

- `src/ledger.ts`: pure `ledger({ verdicts, ran, fee? })` → `Payout[]` (`{ to, yoctoNear, reason }`, amounts as decimal strings, BigInt arithmetic). Any rounding remainder of the Rules pool goes back to the payer, so Payouts always sum to the Fee. `formatNear` prints amounts for the transcript.
- `Payout` type is in `src/domain.ts`; `AuditResult.payouts` carries each Payout plus the hash the payer returned.
- `runAudit` sends each Payout through `ports.payer` (one order per Payout line, returns to the payer included as `agent: "payer"`) after the verdicts and prints them with their reasons. `Payer` gained an optional `simulated` flag; `FakePayer` sets it and the transcript then says "SIMULATED ... sends nothing on chain".
- "Ran" means produced a valid answer: Scout if it returned a map, Rules agent if it returned Rules, Attacker if it was asked; the Referee always runs. Prover and Reporter don't exist yet, so their shares (and any Proven Rule's share) go to the payer. Ticket 06/07 should add `ran.add("prover")` / `ran.add("reporter")` in `runAudit` when they land.
- Fake payer by default: `replayPorts` uses `FakePayer`, and no real payer exists yet. Whoever builds the live command (ticket 04) or real payer (ticket 10) should choose `FakePayer` when settings have no testnet account.
- Not done here: the transcript line for a Conflict cancelling the Prover's claim (needs the Prover, ticket 06+).
