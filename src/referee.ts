// The Referee is ordinary code: no LLM takes part in its decisions.

import type { Finding, Lead, Rule, Scenario, Verdict } from "./domain.ts";
import type { Toolchain } from "./ports.ts";

export interface RefereeResult {
  verdicts: Record<string, Verdict>;
  findings: Finding[];
  leads: Lead[];
}

/**
 * Runs every submitted Scenario through the toolchain itself. A Scenario whose Rule check comes out
 * true is a Finding and its Rule is Broken; any other Scenario becomes a Lead. A Rule with no Finding
 * is Unproven (proofs arrive in a later ticket).
 */
export async function referee(
  contractPath: string,
  rules: Rule[],
  scenarios: Scenario[],
  toolchain: Toolchain,
  log: (line: string) => void,
): Promise<RefereeResult> {
  const byId = new Map(rules.map((r) => [r.id, r]));
  const findings: Finding[] = [];
  const leads: Lead[] = [];

  for (const scenario of scenarios) {
    const rule = byId.get(scenario.rule);
    if (!rule) {
      leads.push({ rule: scenario.rule, reason: `Scenario ${scenario.id} names an unknown Rule`, scenario });
      log(`  ${scenario.id}: names unknown Rule ${scenario.rule}, kept as a Lead`);
      continue;
    }
    const missing = rule.check.slots.map((s) => s.name).filter((n) => !(n in scenario.bind));
    if (missing.length > 0) {
      leads.push({ rule: rule.id, reason: `Scenario ${scenario.id} does not bind ${missing.join(", ")}`, scenario });
      log(`  ${scenario.id}: does not bind ${missing.join(", ")}, kept as a Lead`);
      continue;
    }
    const outcome = await toolchain.runScenario(contractPath, scenario, rule.check);
    if (outcome.ruleCheckTrue) {
      findings.push({ scenario, outcome });
      log(`  ${scenario.id}: Rule check TRUE on the Referee's own run -> Finding against ${rule.id}`);
    } else {
      leads.push({ rule: rule.id, reason: `Scenario ${scenario.id} did not make the Rule check true`, scenario });
      log(`  ${scenario.id}: Rule check false -> Lead on ${rule.id}`);
    }
  }

  const broken = new Set(findings.map((f) => f.scenario.rule));
  const verdicts = Object.fromEntries(rules.map((r): [string, Verdict] => [r.id, broken.has(r.id) ? "Broken" : "Unproven"]));
  return { verdicts, findings, leads };
}
