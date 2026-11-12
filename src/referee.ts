// The Referee is ordinary code: no LLM takes part in its decisions.

import type { Finding, Lead, ProofCheck, ProofSubmission, Rule, Scenario, Verdict } from "./domain.ts";
import type { Toolchain } from "./ports.ts";
import { checkProof } from "./proof-rules.ts";

export interface RefereeResult {
  verdicts: Record<string, Verdict>;
  findings: Finding[];
  leads: Lead[];
  /** One entry per submitted proof, accepted or rejected with a reason. */
  proofs: ProofCheck[];
}

/**
 * Runs every submitted Scenario through the toolchain itself. A Scenario whose Rule check comes out
 * true is a Finding and its Rule is Broken; any other Scenario becomes a Lead. A Rule with no Finding
 * that has a proof accepted by the proof rules (src/proof-rules.ts) is Proven; any other Rule is Unproven.
 */
export async function referee(
  contractPath: string,
  rules: Rule[],
  scenarios: Scenario[],
  toolchain: Toolchain,
  log: (line: string) => void,
  submitted: ProofSubmission = { formalization: "", properties: [], proofs: [] },
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
    if (!rule.check.methods.includes(scenario.call.method)) {
      const why = `calls ${scenario.call.method}, but ${rule.id} is about ${rule.check.methods.join(", ")}`;
      leads.push({ rule: rule.id, reason: `Scenario ${scenario.id} ${why}`, scenario });
      log(`  ${scenario.id}: ${why}, kept as a Lead`);
      continue;
    }
    let outcome;
    try {
      outcome = await toolchain.runScenario(contractPath, scenario, rule.check);
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      leads.push({ rule: rule.id, reason: `Scenario ${scenario.id} could not be run: ${why}`, scenario });
      log(`  ${scenario.id}: could not be run (${why}), kept as a Lead`);
      continue;
    }
    if (outcome.ruleCheckTrue) {
      findings.push({ scenario, outcome });
      log(`  ${scenario.id}: Rule check TRUE on the Referee's own run -> Finding against ${rule.id}`);
    } else {
      leads.push({ rule: rule.id, reason: `Scenario ${scenario.id} did not make the Rule check true`, scenario });
      log(`  ${scenario.id}: Rule check false -> Lead on ${rule.id}`);
    }
  }

  const proofs: ProofCheck[] = [];
  for (const proof of submitted.proofs) {
    const property = submitted.properties.find((p) => p.rule === proof.rule);
    const check = await checkProof(toolchain, submitted.formalization, property, proof);
    proofs.push(check);
    log(`  proof of ${proof.rule}: ${check.accepted ? "ACCEPTED" : "REJECTED"} (${check.reason})`);
  }

  // A Finding always outranks a proof.
  const broken = new Set(findings.map((f) => f.scenario.rule));
  const proven = new Set(proofs.filter((p) => p.accepted).map((p) => p.rule));
  const verdict = (id: string): Verdict => (broken.has(id) ? "Broken" : proven.has(id) ? "Proven" : "Unproven");
  const verdicts = Object.fromEntries(rules.map((r): [string, Verdict] => [r.id, verdict(r.id)]));
  return { verdicts, findings, leads, proofs };
}
