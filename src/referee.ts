// The Referee is ordinary code: no LLM takes part in its decisions.

import { type AskContext, askStructured } from "./agents/ask.ts";
import type { Finding, Lead, Property, ProofCheck, ProofSubmission, Rule, Scenario, Verdict } from "./domain.ts";
import type { Toolchain } from "./ports.ts";
import { checkProof } from "./proof-rules.ts";
import { conflictExplanation } from "./schemas.ts";

/** A Rule with both a reproduced Finding and an accepted proof. */
export interface DetectedConflict {
  rule: string;
  finding: Finding;
  proof: ProofCheck;
}

export interface RefereeResult {
  verdicts: Record<string, Verdict>;
  findings: Finding[];
  leads: Lead[];
  /** One entry per submitted proof, accepted or rejected with a reason. */
  proofs: ProofCheck[];
  /** Every Rule with a reproduced Finding and an accepted proof, in Rule order. */
  conflicts: DetectedConflict[];
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
  const conflicts = rules.flatMap((r): DetectedConflict[] => {
    const finding = findings.find((f) => f.scenario.rule === r.id);
    const proof = proofs.find((p) => p.rule === r.id && p.accepted);
    return finding && proof ? [{ rule: r.id, finding, proof }] : [];
  });
  return { verdicts, findings, leads, proofs, conflicts };
}

/** The Referee's re-check of a proof it accepted, against a Refinement. The same proof rules apply. */
export const recheckProof = (toolchain: Pick<Toolchain, "checkLean">, formalization: string, property: Property, proof: ProofCheck): Promise<ProofCheck> =>
  checkProof(toolchain, formalization, property, { rule: proof.rule, body: proof.body });

/**
 * Asks an LLM to word why a Finding and a proof disagree. The wording decides nothing: the Conflict, the
 * Refinement and the verdict are all settled by code. Null when there is no answer (for example at the cap).
 */
export async function explainConflict(ctx: AskContext, rule: Rule, conflict: DetectedConflict, property: Property | undefined): Promise<string | null> {
  const o = conflict.finding.outcome.observations;
  const answer = await askStructured(
    ctx,
    "referee",
    `A NEAR contract has a Rule. ${rule.id}: ${rule.text}
On the real contract, in a sandbox, this Scenario broke it (the Rule check was true):
  call: ${JSON.stringify(conflict.finding.scenario.call)}
  before: ${JSON.stringify(o.before)}
  after: ${JSON.stringify(o.after)}
  failed receipts: ${o.failedReceipts.length ? o.failedReceipts.join("; ") : "none"}
Yet Lean accepted a proof of the Rule's Property against a model of the contract in which every call is one indivisible step:
  Property: ${property?.statement ?? "(missing)"}
In two or three plain sentences for a contract owner, say what the Scenario shows the real contract doing that the model
does not allow. Do not judge which is right: the Finding stands either way. Answer with JSON only: {"explanation":"<text>"}`,
    conflictExplanation,
  );
  return answer?.explanation.trim() ?? null;
}
