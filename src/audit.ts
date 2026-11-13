import { type Formalization, formalize, refine, rulesAgent, scout } from "./agents/agents.ts";
import { attacker } from "./agents/attacker.ts";
import { type AskContext, type Budget, type Lane, newBudget, newLane } from "./agents/ask.ts";
import { proveOrRefute, prover } from "./agents/prover.ts";
import type { AgentName, AuditResult, Conflict, Counterexample, Finding, Lead, Proof, Refinement, Rule, SandboxSetup, TokenUse } from "./domain.ts";
import { negatedProperty, theoremName } from "./lean.ts";
import { formatNear, ledger } from "./ledger.ts";
import type { AuditPorts } from "./ports.ts";
import { checkCounterexample, comparePaths, type DetectedConflict, explainConflict, recheckProof, referee } from "./referee.ts";
import { VAULT_SETUP } from "./sandbox.ts";
import { DEFAULT_SPEND_CAP_USD } from "./settings.ts";

export interface AuditOptions {
  /** Dollars of LLM calls after which no agent is asked again. Default $5. */
  spendCapUsd?: number;
  /** Stop after the Rules agent (tests of the Scout and Rules agent alone). */
  stopAfter?: "rules";
  /** What the sandbox holds before each Scenario. Defaults to the demo vaults' setup. */
  setup?: SandboxSetup;
  /**
   * Run the Formalization and the Prover. Live Audits always do. Off by default so that Recordings made
   * before the Prover existed (which hold no Formalization) still replay; a Recording stores the choice.
   */
  prover?: boolean;
  /**
   * Settle each Conflict: explain it, ask for Refinements, re-check the old proof. Live Audits always do.
   * Off by default so that Recordings made before Conflicts were settled still replay; a Recording stores it.
   */
  conflicts?: boolean;
  /**
   * After the Refinement that resolves a Conflict, give the Prover the restated Property: a proof of it, or a
   * counterexample checked by Lean. Live Audits always do. Off by default so that older Recordings replay.
   */
  counterexamples?: boolean;
  /**
   * Called with each transcript line as it happens, so a long Audit can be watched. Lines from the part
   * that runs side by side arrive at once, tagged with their side; the transcript still prints them in a
   * fixed order once both sides are done. Never stored in a Recording.
   */
  onLine?: (line: string) => void;
}

/** The Audit options stored in a Recording's settings, so a replay runs the same way the live run did. */
export function auditOptionsFrom(settings: Record<string, unknown>): AuditOptions {
  const o: AuditOptions = {};
  if (typeof settings.spendCapUsd === "number") o.spendCapUsd = settings.spendCapUsd;
  if (settings.stopAfter === "rules") o.stopAfter = "rules";
  if (settings.prover === true) o.prover = true;
  if (settings.conflicts === true) o.conflicts = true;
  if (settings.counterexamples === true) o.counterexamples = true;
  return o;
}

/**
 * The Audit runner: the one entry point the commands call and the tests attach to.
 * Order: Scout, Rules agent, then side by side the Attacker and (the Rules agent's Formalization, then) the
 * Prover, then the Referee, any Conflict with its Refinements, and the Payouts. Replay reads each agent's
 * exchanges and each kind of toolchain outcome in its own order, so the side-by-side part replays exactly.
 * The Reporter arrives in a later ticket.
 */
export async function runAudit(contractPath: string, ports: AuditPorts, options: AuditOptions = {}): Promise<AuditResult> {
  const transcript: string[] = [];
  const onLine = options.onLine ?? (() => {});
  const log = (line: string) => {
    transcript.push(line);
    onLine(line);
  };
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
    return {
      contractPath,
      scoutMap: map,
      rules,
      verdicts: {},
      findings: [],
      leads: [],
      tokens,
      payouts: [],
      formalization: null,
      properties: [],
      proofs: [],
      conflicts: [],
      transcript,
    };
  }

  // The Attacker works on the real contract; the Rules agent's Formalization and the Prover work on Lean.
  // Neither needs the other, so they run side by side. Each side logs to its own buffer and spends from
  // its own lane, so the transcript and the spend cap come out the same however their calls interleave.
  const side = (tag: string, lane?: Lane) => {
    const lines: string[] = [];
    const sideCtx: AskContext = {
      ...ctx,
      log: (l: string) => {
        lines.push(l);
        onLine(`[${tag}] ${l}`);
      },
      lane,
    };
    return { lines, ctx: sideCtx };
  };
  // Held-back side lines go into the transcript only: onLine has already seen them.
  const flush = (lines: string[]) => transcript.push(...lines);
  const remaining = Math.max(0, budget.capUsd - budget.spentUsd);
  const attackSide = side("attacker", options.prover ? newLane("Attacker's side", remaining / 2) : undefined);
  const proofLane = options.prover ? newLane("Prover's side", remaining / 2) : undefined;
  const formalSide = side("rules", proofLane);
  const proverSide = side("prover", proofLane);

  const attacking =
    map && rules.length > 0
      ? attacker(attackSide.ctx, ports.toolchain, contractPath, options.setup ?? VAULT_SETUP, source, map, rules)
      : Promise.resolve({ claimed: [], leads: [], answered: false });
  const proving = (async (): Promise<{ formal: Formalization | null; proofs: Proof[] }> => {
    if (!options.prover || !map || rules.length === 0) return { formal: null, proofs: [] };
    const formal = await formalize(formalSide.ctx, ports.toolchain, source, map, rules);
    if (!formal) return { formal, proofs: [] };
    const proved = await prover(proverSide.ctx, ports.toolchain, formal, rules);
    if (proved.answered) ran.add("prover");
    return { formal, proofs: proved.proofs };
  })();
  const [attack, { formal, proofs }] = await Promise.all([attacking, proving]);
  if (attackSide.ctx.lane?.capReached || proofLane?.capReached) budget.capReached = true;

  if (options.prover) {
    log("");
    log(`(The Attacker and the Prover run side by side; each side may spend half of the $${remaining.toFixed(2)} left under the cap.)`);
    log("");
    log("== Rules agent: Formalization and Properties ==");
    flush(formalSide.lines);
    for (const p of formal?.properties ?? []) log(`  ${p.rule}: ${p.statement}`);
    if (!map || rules.length === 0) log("  (no Rules to state)");
  }

  log("");
  log("== Attacker ==");
  flush(attackSide.lines);
  if (attack.answered) ran.add("attacker");
  if (!map || rules.length === 0) log("  (nothing to attack)");

  if (options.prover) {
    log("");
    log("== Prover ==");
    flush(proverSide.lines);
    if (!formal) log("  (no Formalization to prove anything against)");
  }

  log("");
  log("== Referee ==");
  const submitted = formal ? { ...formal, proofs } : undefined;
  const result = await referee(contractPath, rules, attack.claimed, ports.toolchain, log, submitted);
  const leads: Lead[] = [...attack.leads, ...result.leads];

  const conflicts: Conflict[] = [];
  for (const detected of options.conflicts ? result.conflicts : []) {
    const rule = rules.find((r) => r.id === detected.rule)!;
    conflicts.push(await settleConflict(ctx, ports, source, rule, formal!, detected, options.counterexamples === true));
  }

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
    formalization: formal?.formalization ?? null,
    properties: formal?.properties ?? [],
    proofs: result.proofs,
    conflicts,
    transcript,
  };
}

/** Refinements per Conflict before a proof that still passes is withdrawn. */
export const MAX_REFINEMENTS = 2;

/**
 * One Conflict: shows the Finding and the proof it contradicts, has an LLM word why they disagree,
 * then asks the Rules agent for Refinements of the call the Finding went through and has the Referee
 * re-check the old proof against each. The Rule is Broken whatever happens: a Finding outranks a proof.
 */
async function settleConflict(
  ctx: AskContext,
  ports: AuditPorts,
  source: string,
  rule: Rule,
  formal: Formalization,
  detected: DetectedConflict,
  counterexamples: boolean,
): Promise<Conflict> {
  const { log } = ctx;
  const { finding, proof } = detected;
  const property = formal.properties.find((p) => p.rule === rule.id);
  const o = finding.outcome.observations;
  const call = finding.scenario.call;
  log("");
  log(`== CONFLICT on ${rule.id} ==`);
  log(`  The Referee reproduced a Finding against ${rule.id} and also accepted a proof of its Property.`);
  log(`  Finding ${finding.scenario.id}, on the real contract in the sandbox:`);
  log(`    call: ${call.as} -> ${call.method}(${JSON.stringify(call.args)}), deposit ${call.deposit}`);
  log(`    before: ${JSON.stringify(o.before)}`);
  log(`    after:  ${JSON.stringify(o.after)}`);
  log(`    failed receipts: ${o.failedReceipts.length ? o.failedReceipts.join("; ") : "none"}`);
  log(`    -> ${rule.id}'s Rule check is TRUE: the Rule is broken.`);
  log(`  Proof, against the first Formalization (every call one step):`);
  log(`    theorem ${theoremName(rule.id)} : ${property?.statement ?? "(missing)"}`);
  for (const line of proof.body.trimEnd().split("\n")) log(`      ${line}`);
  log(`    -> ${proof.reason}`);
  const explanation = (await explainConflict(ctx, rule, detected, property)) ?? "(no explanation was worded)";
  log(`  Why they disagree (worded by an LLM; it decides nothing): ${explanation}`);
  log(`  Payout: the Prover's claim on ${rule.id}'s share is cancelled and passes to the Attacker. A Finding outranks a proof.`);

  const refinements: Refinement[] = [];
  let resolvedBy: Formalization | null = null;
  let outcome: Conflict["outcome"] = "unresolved";
  for (let n = 1; n <= MAX_REFINEMENTS; n++) {
    log("");
    log(`== Rules agent: Refinement ${n} of ${call.method}, for ${rule.id} ==`);
    const earlier = refinements.map((r) => ({ formalization: r.formalization, properties: [r.property] }));
    const refined = await refine(ctx, ports.toolchain, source, { rule, formal, proof: proof.body, finding, earlier });
    if (!refined) {
      log("  No Refinement that compiles: the Conflict stays unresolved.");
      break;
    }
    const refinedProperty = refined.properties[0]!;
    const same = refinedProperty.statement.trim() === property?.statement.trim();
    log(`  Refinement ${n} compiles (${refined.formalization.split("\n").length} lines).`);
    // One transcript line per line of the statement, so the transcript and progress.txt line up.
    const [first, ...rest] = refinedProperty.statement.trim().split("\n");
    log(`  ${rule.id}${same ? " (unchanged)" : " (restated)"}: ${first}`);
    for (const line of rest) log(`      ${line}`);
    const recheck = await recheckProof(ports.toolchain, refined.formalization, refinedProperty, proof);
    refinements.push({ method: call.method, formalization: refined.formalization, property: refinedProperty, recheck });
    log("");
    log(`== Referee: re-check of the old proof against Refinement ${n} ==`);
    if (!recheck.accepted) {
      const lean = recheck.outcome?.errors.split("\n").find((l) => /error/.test(l));
      log(`  ${rule.id}: the old proof NO LONGER PASSES (${recheck.reason}${lean ? `: ${lean.trim().slice(0, 200)}` : ""}).`);
      log(`  The Conflict is resolved: the proof held only because the first Formalization made ${call.method} one step.`);
      outcome = "resolved";
      resolvedBy = { formalization: refined.formalization, properties: [refinedProperty] };
      break;
    }
    log(`  ${rule.id}: the old proof STILL PASSES against Refinement ${n}.`);
    if (n === MAX_REFINEMENTS) {
      log(`  The proof still passes after ${MAX_REFINEMENTS} Refinements: it is withdrawn.`);
      outcome = "withdrawn";
    }
  }
  const conflict: Conflict = { rule: rule.id, finding: finding.scenario.id, proof, explanation, refinements, outcome };
  if (counterexamples && resolvedBy) conflict.afterRefinement = await afterRefinement(ctx, ports, rule, finding, resolvedBy, refinements.length);
  log(`  ${rule.id} ends Broken: a Finding outranks a proof.`);
  return conflict;
}

/**
 * The Prover's turn on the restated Property of the Refinement that resolved a Conflict. A counterexample is
 * re-checked by the Referee with Lean and shown beside the Finding; a proof is re-checked the same way. Neither
 * changes the verdict or the Payouts: the Rule is Broken already.
 */
async function afterRefinement(
  ctx: AskContext,
  ports: AuditPorts,
  rule: Rule,
  finding: Finding,
  refined: Formalization,
  n: number,
): Promise<NonNullable<Conflict["afterRefinement"]>> {
  const { log } = ctx;
  const property = refined.properties[0]!;
  const spentBefore = ctx.budget?.byAgent.prover ?? 0;
  log("");
  log(`== Prover: the restated ${rule.id} against Refinement ${n} ==`);
  log(`  (The Prover may prove it, or give a counterexample: values for which Lean confirms it is false.)`);
  const found = await proveOrRefute(ctx, ports.toolchain, refined, rule, finding);
  const spent = (ctx.budget?.byAgent.prover ?? 0) - spentBefore;
  log(`  Cost of this step: $${spent.toFixed(4)}`);

  if (found.kind === "none") {
    log(`  The Audit's result is unchanged.`);
    return { counterexample: null, proof: null };
  }
  log("");
  if (found.kind === "proof") {
    log(`== Referee: re-check of the Prover's proof of the restated ${rule.id} ==`);
    const check = await recheckProof(ports.toolchain, refined.formalization, property, { rule: rule.id, body: found.body, accepted: true, reason: "" });
    log(`  ${rule.id}: ${check.accepted ? "ACCEPTED" : "REJECTED"} (${check.reason}).`);
    if (check.accepted) log(`  The Refinement still does not show what the Finding shows. The Audit's result is unchanged.`);
    return { counterexample: null, proof: check };
  }

  log(`== Referee: re-check of the Prover's counterexample to the restated ${rule.id} ==`);
  const check = await checkCounterexample(ports.toolchain, refined.formalization, property, found);
  const cx: Counterexample = { rule: rule.id, refinement: n, witnesses: found.witnesses, body: found.body, path: found.path, check, samePath: null, comparison: "" };
  if (!check.accepted) {
    log(`  ${rule.id}: the counterexample is REJECTED (${check.reason}). The Audit's result is unchanged.`);
    return { counterexample: cx, proof: null };
  }
  log(`  ${rule.id}: the counterexample HOLDS (${check.reason}).`);
  log(`    theorem ${theoremName(negatedProperty(property).rule)} : ¬ (restated ${rule.id})`);
  for (const line of check.body.split("\n")) log(`      ${line}`);
  const call = finding.scenario.call;
  log("  Beside the Finding:");
  log(`    Finding ${finding.scenario.id} (Attacker, real contract): ${call.as} -> ${call.method}(${JSON.stringify(call.args)}); failed receipts: ${finding.outcome.observations.failedReceipts.length ? finding.outcome.observations.failedReceipts.join("; ") : "none"}`);
  log(`    Counterexample (Prover, Refinement ${n}, in its own words): ${found.path}`);
  const compared = await comparePaths(ctx, rule, finding, { formalization: refined.formalization, property }, found);
  if (compared) {
    cx.samePath = compared.samePath;
    cx.comparison = compared.why;
    log(`    Same path: ${compared.samePath ? "YES" : "NO"}. ${compared.why} (Compared by an LLM; it decides nothing.)`);
    if (compared.samePath) log(`  The Attacker and the Prover agree on why ${rule.id} is broken.`);
  } else log("    Same path: not compared.");
  return { counterexample: cx, proof: null };
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
