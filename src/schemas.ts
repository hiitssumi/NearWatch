import type { CallUnderTest, Condition, Expr, Property, Rule, SandboxAction, Scenario, ScenarioOutcome, ScoutMap, SlotBinding } from "./domain.ts";
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

/** A reference to the call under test, or a literal account name. */
const reference: Check<string> = (v, p) => {
  const s = str(v, p);
  if (s.startsWith("$") && !/^\$(caller|contract|arg:[A-Za-z_][A-Za-z0-9_]*)$/.test(s)) {
    throw new InvalidAnswer(`${p}: "${s}" is not a reference; use $caller, $contract or $arg:<argument name>`);
  }
  return s;
};

const slotBinding: Check<SlotBinding> = variant<SlotBinding>({
  view: object({
    view: object({
      method: str,
      args: (v, p) => {
        const args = anyObject(v, p);
        for (const [k, x] of Object.entries(args)) if (typeof x === "string") reference(x, `${p}.${k}`);
        return args;
      },
    }),
  }),
  account: object({ account: reference }),
});

const rule: Check<Rule> = (v, p) => {
  const r = object({
    id: str,
    text: str,
    check: object({
      methods: array(str, { min: 1 }),
      slots: array(object({ name: str, kind: oneOf("view", "balance"), describe: str, bind: slotBinding }), { min: 1 }),
      condition,
    }),
  })(v, p);
  for (const [i, s] of r.check.slots.entries()) {
    if (s.kind === "view" && !("view" in s.bind)) throw new InvalidAnswer(`${p}.check.slots[${i}]: a view slot must bind {"view":...}`);
    if (s.kind === "balance" && !("account" in s.bind)) throw new InvalidAnswer(`${p}.check.slots[${i}]: a balance slot must bind {"account":...}`);
  }
  return r;
};

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
  const balances = new Set(r.check.slots.filter((s) => s.kind === "balance").map((s) => s.name));
  const readsBalance = (e: Expr): boolean => ("slot" in e ? balances.has(e.slot) : "op" in e ? readsBalance(e.left) || readsBalance(e.right) : false);
  const visit = (c: Condition): void => {
    if ("compare" in c) {
      visitExpr(c.left);
      visitExpr(c.right);
      // A wallet moves by gas whenever its owner signs a call, so an exact comparison of one is never meaningful.
      if ((c.compare === "==" || c.compare === "!=") && (readsBalance(c.left) || readsBalance(c.right))) {
        throw new InvalidAnswer(
          `rule ${r.id}: compares a NEAR balance with "${c.compare}"; wallets move by gas whenever their owner signs a call, so compare with "<" or ">" and a gas allowance`,
        );
      }
    } else ("all" in c ? c.all : c.any).forEach(visit);
  };
  visit(r.check.condition);
}

/** The Rules agent's Formalization, with exactly one Property for each of `rules`. */
export const formalizationAnswer =
  (rules: string[]): Check<{ formalization: string; properties: Property[] }> =>
  (v, p) => {
    const out = object({ formalization: str, properties: array(object({ rule: str, statement: str }), { min: 1 }) })(v, p);
    const seen = new Set<string>();
    for (const prop of out.properties) {
      if (!rules.includes(prop.rule)) throw new InvalidAnswer(`a Property names ${prop.rule}, which is not one of the Rules (${rules.join(", ")})`);
      if (seen.has(prop.rule)) throw new InvalidAnswer(`${prop.rule} has more than one Property`);
      seen.add(prop.rule);
    }
    const missing = rules.filter((r) => !seen.has(r));
    if (missing.length > 0) throw new InvalidAnswer(`no Property for ${missing.join(", ")}; write one for every Rule`);
    return out;
  };

/** The Prover's answer: a proof body only. */
export const proverAnswer: Check<{ proof: string }> = object({ proof: str });

const sandboxAction: Check<SandboxAction> = (v, p) => {
  const kind = oneOf("createAccount", "call", "view")((v as { action?: unknown })?.action, `${p}.action`);
  if (kind === "createAccount") return { action: kind, ...object({ account: str, balance: amount })(v, p) };
  if (kind === "call")
    return { action: kind, ...object({ as: str, method: str, args: anyObject, deposit: amount, gas: amount })(v, p) };
  return { action: kind, ...object({ method: str, args: anyObject })(v, p) };
};


const callUnderTest: Check<CallUnderTest> = object({ as: str, method: str, args: anyObject, deposit: amount, gas: amount });

export const scenario: Check<Scenario> = object({
  id: str,
  rule: str,
  bugClass: str,
  setup: array(sandboxAction),
  call: callUnderTest,
});

/** One round of the Attacker against one Rule: at most one Scenario per open bug class, or a reason to skip it. */
export interface AttackerRound {
  attempts: { bugClass: number; setup: SandboxAction[]; call: CallUnderTest }[];
  skip: { bugClass: number; reason: string }[];
}

const classNumber: Check<number> = (v, p) => {
  if (typeof v === "number" && Number.isInteger(v) && v >= 1) return v;
  throw new InvalidAnswer(`${p}: expected a bug class number, got ${JSON.stringify(v)}`);
};

/** `open` is the bug class numbers the Attacker may still use against this Rule. */
export const attackerRound =
  (open: number[]): Check<AttackerRound> =>
  (v, p) => {
    const raw = v as { skip?: unknown };
    const round = object({
      attempts: array(
        object({
          bugClass: classNumber,
          setup: array(sandboxAction),
          call: callUnderTest,
        }),
      ),
      skip: (x, q) => (x === undefined ? [] : array(object({ bugClass: classNumber, reason: str }))(x, q)),
    })({ ...(v as object), skip: raw?.skip }, p);
    const seen = new Set<number>();
    for (const [i, c] of [...round.attempts.map((a) => a.bugClass), ...round.skip.map((s) => s.bugClass)].entries()) {
      if (!open.includes(c)) throw new InvalidAnswer(`bug class ${c} is not open; open classes are ${open.join(", ")}`);
      if (seen.has(c)) throw new InvalidAnswer(`bug class ${c} appears more than once (item ${i + 1})`);
      seen.add(c);
    }
    return round;
  };

const observationSet = object({ views: record(str), balances: record(amount) });

export const scenarioOutcome: Check<ScenarioOutcome> = object({
  observations: object({ before: observationSet, after: observationSet, failedReceipts: array(str) }),
  ruleCheckTrue: bool,
});
