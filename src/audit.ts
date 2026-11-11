import { attacker, rulesAgent, scout } from "./agents/agents.ts";
import type { AskContext } from "./agents/ask.ts";
import type { AuditResult, Lead, TokenUse } from "./domain.ts";
import type { AuditPorts } from "./ports.ts";
import { referee } from "./referee.ts";

/**
 * The Audit runner: the one entry point the commands call and the tests attach to.
 * Order: Scout, Rules agent, Attacker, Referee. Prover, Reporter and Payouts arrive in later tickets.
 */
export async function runAudit(contractPath: string, ports: AuditPorts): Promise<AuditResult> {
  const transcript: string[] = [];
  const log = (line: string) => transcript.push(line);
  const tokens: Record<string, TokenUse> = {};
  const ctx: AskContext = { llm: ports.llm, tokens, log };

  log(`NearWatch Audit of ${contractPath}`);
  log(`Payer: ${ports.payer.describe}`);
  const source = await ports.source.read(contractPath);

  log("");
  log("== Scout ==");
  const map = await scout(ctx, source);
  if (map) {
    log(`  Money moves through: ${map.moneyMethods.join(", ") || "(none)"}`);
    log(`  Balances recorded in: ${map.balanceStorage.join(", ") || "(none)"}`);
    for (const p of map.privilegedMethods) log(`  Privileged: ${p.method} (${p.whoMayCall})`);
    log(`  Note: ${map.standingNote}`);
  }

  log("");
  log("== Rules agent ==");
  const rules = map ? await rulesAgent(ctx, source, map) : [];
  for (const r of rules) log(`  ${r.id}: ${r.text}`);
  if (rules.length === 0) log("  (no Rules)");

  log("");
  log("== Attacker ==");
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

  log("");
  log("== Tokens ==");
  for (const [agent, t] of Object.entries(tokens)) log(`  ${agent}: ${t.input} in, ${t.output} out`);

  return {
    contractPath,
    scoutMap: map,
    rules,
    verdicts: result.verdicts,
    findings: result.findings,
    leads,
    tokens,
    transcript,
  };
}
