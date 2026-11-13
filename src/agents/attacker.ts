// The Attacker: proposes Scenarios against each Rule, runs each one in the sandbox itself, and sees
// what the harness observed before its next round. It never decides that a Rule is broken: the harness
// evaluates the Rule check, and the Referee re-runs every claimed Scenario before it counts.
//
// Its inputs are the contract source, the Scout's map, the Rules, the sandbox actions (with what the
// sandbox holds before a Scenario starts) and the bug-class list. Nothing else: no contract path, no
// crate name, no hint about where a bug is.

import type { Lead, Rule, SandboxSetup, Scenario, ScenarioOutcome, ScoutMap } from "../domain.ts";
import type { Toolchain } from "../ports.ts";
import { type AttackerRound, attackerRound } from "../schemas.ts";
import { type AskContext, askStructured, capReached } from "./ask.ts";

export const BUG_CLASSES = [
  "state not restored when a cross-contract call or transfer fails",
  "state updated after an external call is scheduled, so a second call can slip in between",
  "a privileged method with no access check",
  "a callback that anyone can call directly",
  "attached deposits counted wrongly",
  "balance arithmetic that can overflow or underflow",
  "a callback starved of gas so it never runs",
] as const;

/** Scenario attempts per (Rule, bug class) pair. */
export const ATTEMPTS_PER_CLASS = 3;

export interface AttackResult {
  /** Scenarios whose Rule check came out true on the Attacker's own run. The Referee re-runs these. */
  claimed: Scenario[];
  /** Every other Scenario, and every bug class skipped or left untried. */
  leads: Lead[];
  /** True when the Attacker gave at least one valid answer, so it counts as having run. */
  answered: boolean;
}

/** One past attempt, as the Attacker is shown it in its next round. */
interface Attempt {
  scenario: Scenario;
  classNo: number;
  outcome?: ScenarioOutcome;
  error?: string;
}

export function sandboxActions(setup: SandboxSetup): string {
  const accounts = Object.entries(setup.accounts)
    .map(([name, yocto]) => `"${name}" (${yocto} yoctoNEAR)`)
    .join(", ");
  const init = setup.init
    ? ` It was initialised by "${setup.init.as}" calling ${setup.init.method}(${JSON.stringify(setup.init.args)}).`
    : "";
  return `Before a Scenario starts the sandbox holds: the contract, deployed to account "${setup.contract}",${init}
and the accounts ${accounts}. You can sign calls as any of these accounts and as any account your Scenario creates.
A Scenario is {"setup":[<action>,...],"call":<call>}:
- "setup" runs first, in order. Use it to create accounts, make deposits, and put the contract in the state you need.
- Then "before" is observed, then "call" (the ONE call under test) runs, then "after" is observed.
  The call must be to one of the Rule's methods. Gas refunds and returned deposits have landed before each observation.
Setup actions (all amounts are yoctoNEAR as decimal strings; 1 NEAR = 1000000000000000000000000; gas is a decimal string, at most 300000000000000):
- {"action":"createAccount","account":<short name such as "alice">,"balance":<yoctoNEAR>}  (the sandbox itself funds the new account)
- {"action":"call","as":<account>,"method":<contract method>,"args":{...},"deposit":<yoctoNEAR>,"gas":<gas>}
- {"action":"view","method":<contract view method>,"args":{...}}
The call under test: {"as":<account>,"method":<one of the Rule's methods>,"args":{...},"deposit":<yoctoNEAR>,"gas":<gas>}
Any account name may be one that does not exist (for example a receiver). A failed call does not stop the Scenario.
A call reserves its gas up front at about 0.1 NEAR per 100 Tgas (unused gas comes back), so a signer needs its deposit plus
that reserve: give each account you create at least 1 NEAR more than it will deposit, or attach less gas.`;
}

function ruleText(rule: Rule): string {
  return `${rule.id}: ${rule.text}
Methods the Rule is about (your call under test must be one of them): ${rule.check.methods.join(", ")}
Rule check (TRUE WHEN THE RULE HAS BEEN BROKEN): ${JSON.stringify(rule.check.condition)}
What each slot reads ($caller is the call's signer, $contract the contract, $arg:<name> that argument of the call;
any other name is an account your setup must create):
${rule.check.slots.map((s) => `- ${s.name}: ${s.describe}. Reads ${JSON.stringify(s.bind)}`).join("\n")}`;
}

function describeAttempt(a: Attempt): string {
  const head = `${a.scenario.id} (bug class ${a.classNo}): setup ${JSON.stringify(a.scenario.setup)} call ${JSON.stringify(a.scenario.call)}`;
  if (a.error !== undefined) return `${head}\n  could not be run: ${a.error}`;
  const o = a.outcome!.observations;
  return `${head}
  before: ${JSON.stringify(o.before)}
  after: ${JSON.stringify(o.after)}
  failed receipts: ${o.failedReceipts.length ? o.failedReceipts.join("; ") : "none"}
  Rule check: false (the Rule was not broken)`;
}

function prompt(source: string, map: ScoutMap, rules: Rule[], rule: Rule, setup: SandboxSetup, open: number[], history: Attempt[]): string {
  const left = (c: number) => ATTEMPTS_PER_CLASS - history.filter((a) => a.classNo === c).length;
  return `You are the Attacker. Your target is Rule ${rule.id} of this NEAR contract. Write Scenarios that break it in a local sandbox.
You do not decide whether a Scenario breaks the Rule: the sandbox harness runs it and evaluates the Rule check over what it observed.

The Rule:
${ruleText(rule)}

Bug classes still open against ${rule.id} (attempts left in brackets):
${open.map((c) => `${c}. ${BUG_CLASSES[c - 1]} [${left(c)}]`).join("\n")}

For each open bug class, either give ONE Scenario that tries it, or skip it with a short reason why it cannot apply to this Rule and contract.
A skipped class is closed. On NEAR a transfer or cross-contract call a method schedules runs later, in its own receipt, after
the method's state changes are saved; if it fails (for example because the receiving account does not exist), only a callback
can undo those changes. So a method that changes state and schedules a transfer with no callback is a reason to TRY class 1,
not to skip it. A Scenario that does not break the Rule leaves its class open until its attempts run out.
Answer with JSON only:
{"attempts":[{"bugClass":<number>,"setup":[...],"call":{...}}],"skip":[{"bugClass":<number>,"reason":"<why>"}]}

Sandbox:
${sandboxActions(setup)}
${history.length ? `\nYour earlier Scenarios against ${rule.id} and what the harness observed:\n${history.map(describeAttempt).join("\n")}\n` : ""}
All Rules of this contract:
${rules.map((r) => `- ${r.id}: ${r.text}`).join("\n")}

Scout's map:
${JSON.stringify(map, null, 2)}

Contract source:
${source}`;
}

/**
 * For each Rule, in rounds: the Attacker proposes at most one Scenario per open bug class, each is run
 * in the sandbox in turn, and the Attacker sees what was observed. A class closes when it is skipped or
 * has had ATTEMPTS_PER_CLASS Scenarios. The Rule is left at its first Scenario whose Rule check is true.
 */
export async function attacker(
  ctx: AskContext,
  toolchain: Toolchain,
  contractPath: string,
  setup: SandboxSetup,
  source: string,
  map: ScoutMap,
  rules: Rule[],
): Promise<AttackResult> {
  const claimed: Scenario[] = [];
  const leads: Lead[] = [];
  let nextId = 1;
  let answered = false;

  for (const rule of rules) {
    if (capReached(ctx)) {
      leads.push({ rule: rule.id, reason: "not attacked: the spend cap was reached" });
      ctx.log(`  ${rule.id}: not attacked (spend cap reached)`);
      continue;
    }
    ctx.log(`  -- ${rule.id} --`);
    let open = BUG_CLASSES.map((_, i) => i + 1);
    const history: Attempt[] = [];
    let broken = false;

    for (let round = 1; round <= ATTEMPTS_PER_CLASS && open.length > 0 && !broken; round++) {
      const answer: AttackerRound | null = await askStructured(
        ctx,
        "attacker",
        prompt(source, map, rules, rule, setup, open, history),
        attackerRound(open),
      );
      if (!answer) {
        leads.push({ rule: rule.id, reason: `bug classes ${open.join(", ")} not tried: the Attacker produced nothing in round ${round}` });
        ctx.log(`  round ${round}: the Attacker produced nothing; classes ${open.join(", ")} left untried`);
        break;
      }
      answered = true;
      for (const s of answer.skip) {
        leads.push({ rule: rule.id, reason: `bug class ${s.bugClass} (${BUG_CLASSES[s.bugClass - 1]}) skipped: ${s.reason}` });
        ctx.log(`  round ${round}: class ${s.bugClass} skipped (${s.reason})`);
      }
      const mentioned = new Set([...answer.attempts, ...answer.skip].map((x) => x.bugClass));
      for (const c of open.filter((c) => !mentioned.has(c))) {
        leads.push({ rule: rule.id, reason: `bug class ${c} (${BUG_CLASSES[c - 1]}) left untried by the Attacker` });
        ctx.log(`  round ${round}: class ${c} left untried`);
      }
      open = open.filter((c) => answer.attempts.some((a) => a.bugClass === c));

      for (const a of answer.attempts) {
        const scenario: Scenario = {
          id: `S${nextId++}`,
          rule: rule.id,
          bugClass: BUG_CLASSES[a.bugClass - 1]!,
          setup: a.setup,
          call: a.call,
        };
        if (broken) {
          leads.push({ rule: rule.id, reason: `Scenario ${scenario.id} not run: ${rule.id} already has a claimed Finding`, scenario });
          ctx.log(`  ${scenario.id} (class ${a.bugClass}): not run, ${rule.id} already claimed`);
          continue;
        }
        const attempt: Attempt = { scenario, classNo: a.bugClass };
        try {
          attempt.outcome = await toolchain.runScenario(contractPath, scenario, rule.check);
        } catch (e) {
          attempt.error = e instanceof Error ? e.message : String(e);
        }
        history.push(attempt);
        if (attempt.outcome?.ruleCheckTrue) {
          broken = true;
          claimed.push(scenario);
          ctx.log(`  ${scenario.id} (class ${a.bugClass}): Rule check TRUE on the Attacker's run -> claimed, sent to the Referee`);
          continue;
        }
        const why = attempt.error !== undefined ? `could not be run: ${attempt.error}` : "did not make the Rule check true";
        leads.push({ rule: rule.id, reason: `Scenario ${scenario.id} ${why}`, scenario });
        ctx.log(`  ${scenario.id} (class ${a.bugClass}, attempt ${history.filter((h) => h.classNo === a.bugClass).length}): ${why}`);
      }
      open = open.filter((c) => history.filter((h) => h.classNo === c).length < ATTEMPTS_PER_CLASS);
    }
    if (!broken) ctx.log(`  ${rule.id}: no claimed Finding`);
  }
  return { claimed, leads, answered };
}
