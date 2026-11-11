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
Answer with JSON only: {"moneyMethods":[...],"balanceStorage":[...],"privilegedMethods":[{"method":...,"whoMayCall":...}],"standingNote":...}
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
A Rule check declares named slots (kind "view" or "balance") and a condition over {"slot":name,"when":"before"|"after"},
{"number":"<decimal>"} and {"op":"add"|"sub","left":...,"right":...}, combined with {"compare":op,...}, {"all":[...]}, {"any":[...]}.
Answer with JSON only: {"rules":[{"id":"R1","text":...,"check":{"slots":[...],"condition":...}}]}

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
