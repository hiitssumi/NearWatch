// Pieces of the hand-made Recording that several tests use directly.
import type { Rule, Scenario, ScenarioOutcome } from "../src/domain.ts";
import type { Recording } from "../src/replay/recording.ts";

export const HAND_MADE = new URL("../recordings/hand-made.json", import.meta.url).pathname;

export const handMadeRules = (r: Recording): Rule[] => JSON.parse(r.exchanges[1]!.answer).rules;

/** The one Scenario the hand-made Attacker writes: deposit, then withdraw to an account that does not exist. */
export function handMadeScenario(r: Recording): Scenario {
  const a = JSON.parse(r.exchanges[2]!.answer).attempts[0];
  return { id: "S1", rule: "R1", bugClass: "state not restored when a cross-contract call or transfer fails", actions: a.actions, bind: a.bind };
}

/** A stored runScenario outcome: index 0 is the Attacker's own run of S1, index 1 the Referee's re-run. */
export function storedOutcome(r: Recording, index: 0 | 1): ScenarioOutcome {
  const e = r.toolchain[index]!;
  if (e.op !== "runScenario" || !("outcome" in e)) throw new Error(`toolchain[${index}] is not a Scenario outcome`);
  return e.outcome;
}
