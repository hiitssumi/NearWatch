// The Scout and the Rules agent (the Attacker is in attacker.ts). Each is a function from typed
// inputs to typed outputs; the prompt wording is a first draft and is not tested.

import type { Rule, ScoutMap } from "../domain.ts";
import { rulesAnswer, scoutMap } from "../schemas.ts";
import { type AskContext, askStructured } from "./ask.ts";
import { BUG_CLASSES } from "./attacker.ts";

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
A Rule check is about ONE contract call. An attacker builds Scenarios: some setup (creating accounts, deposits, any calls),
then "before" is observed, then exactly one call under test runs, then "after" is observed. Gas refunds and returned
deposits have landed by each observation, and an ordinary call costs well under 0.01 NEAR of gas.
A Scenario whose observations make the check TRUE is reported as proof the Rule is broken.

A Rule check has:
- "methods": the contract methods the Rule is about. The call under test must be one of them.
- "slots": the values it reads. Each slot is {"name":<name>,"kind":"view"|"balance","describe":<what it is>,"bind":<what to read>}.
  "view" reads a contract view method: "bind":{"view":{"method":<view method>,"args":{...}}}.
  "balance" reads an account's NEAR balance in yoctoNEAR: "bind":{"account":<account>}.
  You write the bindings, not the attacker. In an account, or a string view argument, use a reference to the call under test:
  "$caller" (the account that signs it), "$contract" (the contract's own account) or "$arg:<name>" (that argument of the call,
  for example "$arg:receiver_id"). Any other string is a fixed account name the attacker's setup must create.
- "condition": built only from these forms:
  {"compare":"<"|"<="|"=="|"!="|">="|">","left":<expr>,"right":<expr>}  (use these symbols, never words like "lt")
  {"all":[<condition>,...]}  {"any":[<condition>,...]}
  where <expr> is {"slot":<slot name>,"when":"before"|"after"}, {"number":"<decimal integer string>"}, or {"op":"add"|"sub","left":<expr>,"right":<expr>}.
  Every slot the condition uses must be declared in "slots". Booleans read as 1 (true) and 0 (false).

A Rule check must stay FALSE whenever the contract behaves correctly, whatever setup and call arguments the attacker picks:
- Bind each slot to exactly the account or value the Rule is about, through the references above.
- A Rule that applies only in some situation (for example while deposits are paused) must test that situation in the
  condition itself (for example, the paused flag is true before the call).
- Allow for gas wherever a NEAR balance is compared: the signer of the call pays gas even when the call fails, and the
  signer may also be the receiver it names. Never compare a NEAR balance with "==" or "!="; use "<" or ">" with an allowance.
The attacker will try these bug classes. Write each check so that it turns true if any of them happens to the money its Rule
protects; in particular, compare what a record loses or gains with what really arrived where it was meant to go:
${BUG_CLASSES.map((c, i) => `${i + 1}. ${c}`).join("\n")}
Do not make a check depend on the money having moved: when a transfer or cross-contract call fails, NEAR may come back to
the contract, and a record changed for money that never arrived where it was meant to go is exactly a break.
Cover every method the Scout's map lists as moving money: for each one, at least one Rule must say that the change it makes
to recorded balances is matched by real NEAR moving to or from the right account.
Write at most 5 Rules: the ones that matter most for the money this contract holds.

Example of the format only (an unrelated voting contract, not a Rule for this one):
{"rules":[{"id":"R1","text":"One vote call adds at most one vote to the proposal it names.",
 "check":{"methods":["vote"],
 "slots":[{"name":"votes","kind":"view","describe":"votes on the proposal being voted on","bind":{"view":{"method":"get_votes","args":{"proposal_id":"$arg:proposal_id"}}}}],
 "condition":{"compare":">","left":{"op":"sub","left":{"slot":"votes","when":"after"},"right":{"slot":"votes","when":"before"}},"right":{"number":"1"}}}}]}

Answer with JSON only, in that shape, with ids R1, R2, ...

Scout's map:
${JSON.stringify(map, null, 2)}

Contract source:
${source}`,
    rulesAnswer,
  );
  return answer?.rules ?? [];
}
