// The Referee is ordinary code: no LLM takes part in its decisions.

import { clip } from "./agents/agents.ts";
import { type AskContext, askStructured } from "./agents/ask.ts";
import type { Finding, Lead, Property, ProofCheck, ProofSubmission, Rule, Scenario, Verdict } from "./domain.ts";
import { counterexampleBody, negatedProperty } from "./lean.ts";
import type { Toolchain } from "./ports.ts";
import { checkProof, screenProofBody } from "./proof-rules.ts";
import { conflictExplanation, pathComparison } from "./schemas.ts";

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
 * The Referee's re-check of a counterexample, with Lean itself: each witness and the tactics are screened as
 * a proof body is, then Lean must accept a proof of the negated Property that applies it to the witnesses.
 */
export async function checkCounterexample(
  toolchain: Pick<Toolchain, "checkLean">,
  formalization: string,
  property: Property,
  cx: { witnesses: string[]; body: string },
): Promise<ProofCheck> {
  const body = counterexampleBody(cx.witnesses, cx.body);
  for (const [i, w] of cx.witnesses.entries()) {
    const why = screenProofBody(w);
    if (why) return { rule: property.rule, body, accepted: false, reason: `witness ${i + 1}: ${why.replace(/^the proof( body)?/, "it")}` };
  }
  const why = screenProofBody(cx.body);
  if (why) return { rule: property.rule, body, accepted: false, reason: why };
  const check = await checkProof(toolchain, formalization, negatedProperty(property), { rule: property.rule, body });
  return check.accepted ? { ...check, reason: `Lean confirms the Property is false for these values; axioms: ${check.outcome!.axioms.join(", ") || "none"}` } : check;
}

/**
 * Asks an LLM whether a counterexample follows the same path as the Finding. The answer decides nothing: the
 * counterexample was checked by Lean and the Rule is Broken either way. Null when there is no answer.
 */
export async function comparePaths(
  ctx: AskContext,
  rule: Rule,
  finding: Finding,
  refined: { formalization: string; property: Property },
  cx: { witnesses: string[]; path: string },
): Promise<{ samePath: boolean; why: string } | null> {
  const o = finding.outcome.observations;
  return askStructured(
    ctx,
    "referee",
    `A NEAR contract has a Rule. ${rule.id}: ${rule.text}
On the real contract, in a sandbox, this Scenario broke it (the Rule check was true):
  call: ${JSON.stringify(finding.scenario.call)}
  before: ${JSON.stringify(o.before)}
  after: ${JSON.stringify(o.after)}
  failed receipts: ${o.failedReceipts.length ? o.failedReceipts.join("; ") : "none"}
Separately, Lean confirmed a counterexample to the Rule's Property against this Lean model of the contract:
${clip(refined.formalization)}
  Property: ${refined.property.statement}
  The Property applied to these values, in order, is false: ${cx.witnesses.join(" | ")}
  The Prover describes its steps as: ${cx.path}
Does the counterexample follow the same path as the Scenario: the same call, the same outcome of any transfer it
schedules (it lands, or it fails), and the same kind of wrong state afterwards? Account names and amounts may differ.
Answer with JSON only: {"samePath":true|false,"why":"<one or two plain sentences>"}`,
    pathComparison,
  );
}

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
