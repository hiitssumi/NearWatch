import { attacker, rulesAgent, scout } from "./agents/agents.ts";
import { type AskContext, type Budget, newBudget } from "./agents/ask.ts";
import type { AgentName, AuditResult, Lead, TokenUse } from "./domain.ts";
import { formatNear, ledger } from "./ledger.ts";
import type { AuditPorts } from "./ports.ts";
import { referee } from "./referee.ts";
import { DEFAULT_SPEND_CAP_USD } from "./settings.ts";

export interface AuditOptions {
  /** Dollars of LLM calls after which no agent is asked again. Default $5. */
  spendCapUsd?: number;
  /** Stop after the Rules agent (used while no sandbox toolchain exists; ticket 05 removes the need). */
  stopAfter?: "rules";
}

/** The Audit options stored in a Recording's settings, so a replay runs the same way the live run did. */
export function auditOptionsFrom(settings: Record<string, unknown>): AuditOptions {
  const o: AuditOptions = {};
  if (typeof settings.spendCapUsd === "number") o.spendCapUsd = settings.spendCapUsd;
  if (settings.stopAfter === "rules") o.stopAfter = "rules";
  return o;
}

/**
 * The Audit runner: the one entry point the commands call and the tests attach to.
 * Order: Scout, Rules agent, Attacker, Referee, Payouts. Prover and Reporter arrive in later tickets.
 */
export async function runAudit(contractPath: string, ports: AuditPorts, options: AuditOptions = {}): Promise<AuditResult> {
  const transcript: string[] = [];
  const log = (line: string) => transcript.push(line);
  const tokens: Record<string, TokenUse> = {};
  const budget = newBudget(options.spendCapUsd ?? DEFAULT_SPEND_CAP_USD);
  const ctx: AskContext = { llm: ports.llm, tokens, log, budget };
  // An agent counts as having run when it produced a valid answer; its share is returned otherwise.
  const ran = new Set<AgentName>(["referee"]);

  log(`NearWatch Audit of ${contractPath}`);
  log(`Payer: ${ports.payer.describe}`);
  const source = await ports.source.read(contractPath);

  log("");
  log("== Scout ==");
  const map = await scout(ctx, source);
  if (map) ran.add("scout");
  if (map) {
    log(`  Money moves through: ${map.moneyMethods.join(", ") || "(none)"}`);
    log(`  Balances recorded in: ${map.balanceStorage.join(", ") || "(none)"}`);
    for (const p of map.privilegedMethods) log(`  Privileged: ${p.method} (${p.whoMayCall})`);
    log(`  Note: ${map.standingNote}`);
  }

  log("");
  log("== Rules agent ==");
  const rules = map ? await rulesAgent(ctx, source, map) : [];
  if (rules.length > 0) ran.add("rules");
  for (const r of rules) {
    log(`  ${r.id}: ${r.text}`);
    log(`      broken when: ${JSON.stringify(r.check.condition)}`);
  }
  if (rules.length === 0) log("  (no Rules)");

  if (options.stopAfter === "rules") {
    log("");
    log("(The Audit stops after the Rules agent: there is no sandbox toolchain yet.)");
    logCosts(log, tokens, budget);
    return { contractPath, scoutMap: map, rules, verdicts: {}, findings: [], leads: [], tokens, payouts: [], transcript };
  }

  log("");
  log("== Attacker ==");
  if (map && rules.length > 0) ran.add("attacker");
  const attack = map && rules.length > 0 ? await attacker(ctx, source, map, rules) : { scenarios: [], leads: [] };
  for (const s of attack.scenarios) log(`  ${s.id} against ${s.rule} (${s.bugClass}): ${s.actions.length} actions`);
  for (const l of attack.leads) log(`  Lead on ${l.rule}: ${l.reason}`);
  if (attack.scenarios.length === 0 && attack.leads.length === 0) log("  (nothing proposed)");

  log("");
  log("== Referee ==");
  const result = await referee(contractPath, rules, attack.scenarios, ports.toolchain, log);
  const leads: Lead[] = [...attack.leads, ...result.leads];

  log("");
  log("== Verdicts ==");
  for (const r of rules) log(`  ${r.id}: ${result.verdicts[r.id]}`);

  logCosts(log, tokens, budget);

  log("");
  log("== Payouts ==");
  if (ports.payer.simulated) log("  SIMULATED: the fake payer records these Payouts and sends nothing on chain.");
  const payouts: AuditResult["payouts"] = [];
  for (const p of ledger({ verdicts: result.verdicts, ran })) {
    const { hash } = await ports.payer.send({ agent: p.to, yoctoNear: p.yoctoNear });
    payouts.push({ ...p, hash });
    log(`  ${p.to}: ${formatNear(p.yoctoNear)} (${p.reason}) [${hash}]`);
  }

  return {
    contractPath,
    scoutMap: map,
    rules,
    verdicts: result.verdicts,
    findings: result.findings,
    leads,
    tokens,
    payouts,
    transcript,
  };
}

function logCosts(log: (line: string) => void, tokens: Record<string, TokenUse>, budget: Budget): void {
  log("");
  log("== Tokens and spend ==");
  for (const [agent, t] of Object.entries(tokens)) {
    const usd = budget.byAgent[agent];
    log(`  ${agent}: ${t.input} in, ${t.output} out${usd === undefined ? "" : `, $${usd.toFixed(4)}`}`);
  }
  log(`  Total spend: $${budget.spentUsd.toFixed(4)} (cap $${budget.capUsd.toFixed(2)})${budget.capReached ? " -- CAP REACHED" : ""}`);
}
