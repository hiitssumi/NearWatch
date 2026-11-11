import type { Condition, Expr, Rule, SandboxAction, Scenario, ScenarioOutcome, ScoutMap, SlotBinding } from "./domain.ts";
import { amount, anyObject, array, bool, type Check, InvalidAnswer, object, oneOf, record, str, variant } from "./validate.ts";

export const scoutMap: Check<ScoutMap> = object({
  moneyMethods: array(str),
  balanceStorage: array(str),
  privilegedMethods: array(object({ method: str, whoMayCall: str })),
  standingNote: str,
});

const expr: Check<Expr> = variant<Expr>({
  slot: object({ slot: str, when: oneOf("before", "after") }),
  number: object({ number: amount }),
  op: (v, p) => object({ op: oneOf("add", "sub"), left: expr, right: expr })(v, p),
});

const condition: Check<Condition> = variant<Condition>({
  compare: object({ compare: oneOf("<", "<=", "==", "!=", ">=", ">"), left: expr, right: expr }),
  all: (v, p) => object({ all: array(condition, { min: 1 }) })(v, p),
  any: (v, p) => object({ any: array(condition, { min: 1 }) })(v, p),
});

const rule: Check<Rule> = object({
  id: str,
  text: str,
  check: object({
    slots: array(object({ name: str, kind: oneOf("view", "balance"), describe: str }), { min: 1 }),
    condition,
  }),
});

export const rulesAnswer: Check<{ rules: Rule[] }> = (v, p) => {
  const out = object({ rules: array(rule, { min: 1 }) })(v, p);
  for (const r of out.rules) checkSlotsUsed(r);
  return out;
};

function checkSlotsUsed(r: Rule): void {
  const names = new Set(r.check.slots.map((s) => s.name));
  const visitExpr = (e: Expr): void => {
    if ("slot" in e && !names.has(e.slot)) throw new InvalidAnswer(`rule ${r.id}: condition uses undeclared slot "${e.slot}"`);
    if ("op" in e) (visitExpr(e.left), visitExpr(e.right));
  };
  const visit = (c: Condition): void => {
    if ("compare" in c) (visitExpr(c.left), visitExpr(c.right));
    else ("all" in c ? c.all : c.any).forEach(visit);
  };
  visit(r.check.condition);
}

const sandboxAction: Check<SandboxAction> = (v, p) => {
  const kind = oneOf("createAccount", "call", "view")((v as { action?: unknown })?.action, `${p}.action`);
  if (kind === "createAccount") return { action: kind, ...object({ account: str, balance: amount })(v, p) };
  if (kind === "call")
    return { action: kind, ...object({ as: str, method: str, args: anyObject, deposit: amount, gas: amount })(v, p) };
  return { action: kind, ...object({ method: str, args: anyObject })(v, p) };
};

const slotBinding: Check<SlotBinding> = variant<SlotBinding>({
  view: object({ view: object({ method: str, args: anyObject }) }),
  account: object({ account: str }),
});

export const scenario: Check<Scenario> = object({
  id: str,
  rule: str,
  bugClass: str,
  actions: array(sandboxAction, { min: 1 }),
  bind: record(slotBinding),
});

export const attackerAnswer: Check<{ scenarios: Scenario[]; leads: { rule: string; reason: string }[] }> = object({
  scenarios: array(scenario),
  leads: array(object({ rule: str, reason: str })),
});

const observationSet = object({ views: record(str), balances: record(amount) });

export const scenarioOutcome: Check<ScenarioOutcome> = object({
  observations: object({ before: observationSet, after: observationSet, failedReceipts: array(str) }),
  ruleCheckTrue: bool,
});
