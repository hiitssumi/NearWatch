// The LLM agents in this ticket: Scout, Rules agent, Attacker. Each is a function from typed
// inputs to typed outputs; the prompt wording is a first draft and is not tested.

import type { Rule, Scenario, ScoutMap } from "../domain.ts";
import { attackerAnswer, rulesAnswer, scoutMap } from "../schemas.ts";
import { type AskContext, askStructured } from "./ask.ts";

export const BUG_CLASSES = [
  "state not restored when a cross-contract call or transfer fails",
  "state updated after an external call is scheduled, so a second call can slip in between",
  "a privileged method with no access check",
  "a callback that anyone can call directly",
  "attached deposits counted wrongly",
  "balance arithmetic that can overflow or underflow",
  "a callback starved of gas so it never runs",
] as const;

export const SANDBOX_ACTIONS = `- {"action":"createAccount","account":<name>,"balance":<yoctoNEAR string>}
- {"action":"call","as":<account>,"method":<name>,"args":{...},"deposit":<yoctoNEAR string>,"gas":<gas string>}
- {"action":"view","method":<name>,"args":{...}}
An action may name an account that does not exist.`;

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

export async function attacker(
  ctx: AskContext,
  source: string,
  map: ScoutMap,
  rules: Rule[],
): Promise<{ scenarios: Scenario[]; leads: { rule: string; reason: string }[] }> {
  const answer = await askStructured(
    ctx,
    "attacker",
    `You are the Attacker. Propose Scenarios that break the Rules below in a local sandbox.
A Scenario is {"id","rule","bugClass","actions":[...],"bind":{slotName: {"view":{"method","args"}} | {"account":name}}}.
Bind every slot the Rule's check declares. Sandbox actions you may use:
${SANDBOX_ACTIONS}
Known bug classes to try:
${BUG_CLASSES.map((c) => `- ${c}`).join("\n")}
Answer with JSON only: {"scenarios":[...],"leads":[{"rule","reason"}]}

Rules:
${JSON.stringify(rules, null, 2)}

Scout's map:
${JSON.stringify(map, null, 2)}

Contract source:
${source}`,
    attackerAnswer,
  );
  return answer ?? { scenarios: [], leads: [] };
}
