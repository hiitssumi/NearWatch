# 05: Attacker reaches a Finding

**What to build:** The live Attacker proposes Scenarios against each Rule, the harness runs them, and the Referee re-runs any Scenario that claims to break a Rule before calling it a Finding. A live Audit of the buggy vault ends with Rule 1 Broken. This is Thursday's milestone.

**Blocked by:** 02, 04

**Status:** resolved

- [x] The Attacker's inputs are the contract source, the Scout's map, the Rules, the list of sandbox actions, and the bug-class list. Nothing else. The Recording shows these inputs.
- [x] The bug-class list holds the seven classes named in the spec.
- [x] For each Rule the Attacker tries each bug class, with up to three Scenario attempts per pair, and stops at the first Finding for that Rule.
- [x] After a failed attempt the Attacker sees what the harness observed and can adjust.
- [x] The Referee re-runs each claimed Scenario through the toolchain itself. It is a Finding only if the Referee's own run makes the Rule check true.
- [x] Every other Scenario is listed as a Lead.
- [x] A live Audit of the buggy vault ends with Rule 1 Broken, without the Attacker being told where the bug is.
- [ ] If the Attacker cannot do that within its budget, the ticket stops and reports what was tried. No hint beyond the bug-class list is added.
- [x] Each Scenario is written to the Audit's folder in a form that can be re-run.
- [x] The Recording of this run replays to the same verdicts in a fast test.
- [x] The Attacker uses the model named in settings, which defaults to NEAR AI's uncensored DeepSeek model.

## Comments

**12 Nov 2026: built; the live run finds the planted bug unaided, but also two false Findings. One design decision is open (below).**

How the Attacker works (`src/agents/attacker.ts`):
- It works in rounds per Rule. Each round is one LLM call that gives, for each open bug class, either one Scenario or a reason to skip it. A skipped class is closed. Each Scenario runs in the sandbox at once, and the next round's prompt shows what the harness observed, or the harness's error. A class closes after 3 Scenarios. The Attacker leaves a Rule at its first Scenario whose Rule check is true.
- Only claimed Scenarios go to the Referee, which re-runs each one. Every other Scenario, and every skipped or untried class, is a Lead. The loop assigns Scenario ids `S1, S2, ...` across the Audit.
- The prompt holds the source text, the Scout's map, the Rules, the sandbox actions (with what the sandbox holds before a Scenario starts) and the bug classes. It holds no path or crate name; a test checks this.
- `RecordingToolchain` stores every sandbox run, including a run that errors (`{op, scenario, error}`), so replay is exact. `live-audit.ts` now uses the real sandbox and writes `scenarios/<id>.json`. `npm run scenario -- <file>` re-runs one.

Changes outside the Attacker, found by live runs:
- Harness: it lets 3 blocks pass before each observation. Otherwise a call's unused gas has not been refunded yet, and a 300 Tgas deposit looks 0.3 NEAR short (a false Finding).
- Harness: a new `{"action":"snapshot"}` marks where "before" is taken. Without it, "before" always came before any deposit, so a lost withdrawal showed no debit. In run 2 the Attacker tried exactly the right attack and could not see it.
- Live gateway: answers are streamed. Node's `fetch` gives up waiting for headers after 300 s, and GLM spends longer than that reasoning on the Rules. A call now fails after 15 min in all, or after 2 min with no data.
- Settings: `requestExtras` per model. The Attacker's DeepSeek model gets `chat_template_kwargs: {thinking: false}`. With thinking on, one round took more than 5 minutes; with it off, about 17 s. `reasoning_effort` and `thinking: {type: disabled}` were ignored.
- Rules prompt: every Rule check must stay false under honest use, every money method in the Scout's map must be covered, and there are at most 5 Rules.

Live runs of `rust/vaults/buggy`, about $1.40 in total:
- Run 1: the Attacker call timed out (thinking).
- Run 2: 4 false Findings (gas refund, unrelated deposits, a re-pause), and the planted bug was missed (no snapshot).
- Runs 3–4: the Rules call failed (300 s fetch limit).
- Run 5: clean, but no Rule covered withdraw.
- Run 6: `recordings/live-attacker-buggy-vault.json`, $0.30. Replay matches line for line.
  - **R1 Broken by S3, the planted bug.** carol deposits 1 NEAR, then withdraws 1 NEAR to `dave`, who doesn't exist. The transfer fails and her balance is never restored, so 1 NEAR leaves her wallet and nobody gets it.
  - **R2 Broken by S5: false.** The Scenario withdraws to bob but binds the "receiver" slot to alice.
  - **R4 Broken by S17: false.** It unpauses, deposits, then re-pauses, so the paused flag is true at both ends but not throughout.

**Decision (12 Nov, builder chose the fix).** A Scenario is now setup actions plus **one call under test**. The Rule check names its methods and owns what each slot reads, through `$caller`, `$contract`, `$arg:<name>` or a fixed account name. The Attacker picks only the setup and the call. See `docs/adr/0003`, plus the spec and glossary updates.

Follow-up fixes from live runs 7–10:
- The validator rejects `==`/`!=` on a NEAR balance. Run 7's only Finding was a refused withdraw-to-self that moved only gas.
- The harness reports the whole error chain. Run 8's right attack failed in setup with "unable to broadcast"; the real cause was `NotEnoughBalance`, because 300 Tgas reserves about 0.3 NEAR. The Attacker prompt now says so.
- The Rules prompt now includes the bug-class list, and says a check must not depend on the money having moved. A failed transfer returns NEAR to the contract, and GLM kept writing withdraw checks that only applied "when NEAR left the vault". **This is guidance to the Rules agent, not to the Attacker; the README (ticket 12) should say so.**

Live runs 7–10 on the new design, about $1.70:
- Run 7: one false Finding (the exact wallet comparison).
- Run 8: none.
- Run 9: one real Finding, not the planted bug.
- Run 10, `recordings/live-attacker-buggy-vault.json`, $0.36. Replay matches, and a fast test covers it. It has **no false Findings**:
  - **R2 Broken by S5, the planted bug, found unaided.** alice withdraws 1 NEAR to `nobody-nonexistent-account`. Her record falls from 5 to 4 NEAR, the receiver gets nothing, and the vault keeps the NEAR. On the fixed vault the same Scenario holds.
  - **R4 Broken by S18, real but not planted.** NEAR attached to a call of the view method `balance_of` stays in the vault, credited to nobody. near-sdk rejects deposits only on `&mut self` methods. **The fixed vault has the same issue**, so ticket 14's "no Finding" will not hold as written.

Total live spend on this ticket: about $3.10.
