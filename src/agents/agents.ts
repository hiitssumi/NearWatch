// The Scout and the Rules agent (the Attacker is in attacker.ts). Each is a function from typed
// inputs to typed outputs; the prompt wording is a first draft and is not tested.

import type { Rule, ScoutMap } from "../domain.ts";
import { rulesAnswer, scoutMap } from "../schemas.ts";
import { type AskContext, askStructured } from "./ask.ts";

export function scout(ctx: AskContext, source: string): Promise<ScoutMap | null> {
  return askStructured(
    ctx,
    "scout",
    `You are the Scout. Map where money enters, sits and leaves this NEAR contract, and who can change it.
Answer with JSON only, in exactly this shape (every list item in moneyMethods and balanceStorage is a plain string, not an object):
{"moneyMethods":["<method>: <how money moves through it>"],"balanceStorage":["<field>: <what it records>"],"privilegedMethods":[{"method":"<method>","whoMayCall":"<who>"}],"standingNote":"<text>"}
The standingNote must say that key and upgrade control has to be checked on the deployed account.

Contract source:
${source}`,
    scoutMap,
  );
}

export async function rulesAgent(ctx: AskContext, source: string, map: ScoutMap): Promise<Rule[]> {
  const answer = await askStructured(
    ctx,
    "rules",
    `You are the Rules agent. Write the Rules this contract must always keep, in plain English, each with a Rule check:
a comparison over sandbox observations that is TRUE WHEN THE RULE HAS BEEN BROKEN.
A Rule check has:
- "slots": the values it reads. Each slot is {"name":<name>,"kind":"view"|"balance","describe":<what it is>}; all three fields are required.
  "view" is the result of a contract view method; "balance" is an account's NEAR balance in yoctoNEAR.
- "condition": built only from these forms:
  {"compare":"<"|"<="|"=="|"!="|">="|">","left":<expr>,"right":<expr>}  (use these symbols, never words like "lt")
  {"all":[<condition>,...]}  {"any":[<condition>,...]}
  where <expr> is {"slot":<slot name>,"when":"before"|"after"}, {"number":"<decimal integer string>"}, or {"op":"add"|"sub","left":<expr>,"right":<expr>}.
Every slot the condition uses must be declared in "slots".

How a Rule check is used: an attacker writes Scenarios (sequences of contract calls in a local sandbox) and binds each slot
to a concrete view call or account. "before" is observed at a point the Scenario chooses (after any setup such as deposits),
"after" once every call has run; gas refunds have landed by then, and an ordinary call costs well under 0.01 NEAR of gas.
A Scenario whose observations make the check TRUE is reported as proof the Rule is broken.
So a Rule check must stay FALSE in every Scenario where the contract behaves correctly, however that Scenario is built:
- It must not be made true by other honest activity in the same window (another user's deposit or withdrawal, a payment
  received from elsewhere, the owner using a legitimate power). Prefer slots that only the Rule's subject can change.
- A Rule that applies only in some situation (for example while deposits are paused) must test that situation in the
  condition itself (for example, the paused flag is true both before and after).
- Allow for gas where a wallet balance is compared.
Write at most 5 Rules: the ones that matter most for the money this contract holds.

Example of the format only (an unrelated contract, not a Rule for this one):
{"rules":[{"id":"R1","text":"An account's NEAR balance never falls by more than 1 NEAR in one Scenario.",
 "check":{"slots":[{"name":"alice_wallet","kind":"balance","describe":"alice's NEAR account balance"}],
 "condition":{"compare":">","left":{"op":"sub","left":{"slot":"alice_wallet","when":"before"},"right":{"slot":"alice_wallet","when":"after"}},"right":{"number":"1000000000000000000000000"}}}}]}

Answer with JSON only, in that shape, with ids R1, R2, ...

Scout's map:
${JSON.stringify(map, null, 2)}

Contract source:
${source}`,
    rulesAnswer,
  );
  return answer?.rules ?? [];
}
