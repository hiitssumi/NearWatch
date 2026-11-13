// The Reporter: one LLM call with a fixed prompt, built from the Referee's result. The LLM only words plain
// English: a summary, and a passage for each Rule, each Finding and each Conflict. Everything that is a fact
// (the verdicts, the calls, the commands to re-run a Scenario, the Leads, the costs, what a proof covers) is
// written into the report by code, so the Reporter cannot change it, and its answer is rejected if it names a
// Rule, Finding or Conflict that does not exist, leaves one out, or gives a Rule a verdict it does not have.

import type { Conflict, Finding, Lead, ProofAttempt, Rule, Verdict } from "../domain.ts";
import { array, type Check, InvalidAnswer, object, str } from "../validate.ts";
import { type AskContext, askStructured } from "./ask.ts";

/** What the report is built from: the Referee's result and what the Audit spent. */
export interface ReportFacts {
  contractPath: string;
  /** The Audit's folder, for the commands that re-run a Scenario; null when it is not known. */
  folder: string | null;
  rules: Rule[];
  verdicts: Record<string, Verdict>;
  findings: Finding[];
  leads: Lead[];
  conflicts: Conflict[];
  proofAttempts: ProofAttempt[];
}

export interface ReportWords {
  summary: string;
  rules: { rule: string; text: string }[];
  findings: { scenario: string; text: string }[];
  conflicts: { rule: string; text: string }[];
}

const VERDICT_WORD = /\b(broken|proven|unproven)\b/gi;

/** The answer's shape, checked against the facts: exactly the Rules, Findings and Conflicts there are. */
function wordsFor(facts: ReportFacts): Check<ReportWords> {
  const shape = object({
    summary: str,
    rules: array(object({ rule: str, text: str })),
    findings: array(object({ scenario: str, text: str })),
    conflicts: array(object({ rule: str, text: str })),
  });
  const exactly = (what: string, got: string[], want: string[]) => {
    const g = [...got].sort().join(", ");
    const w = [...want].sort().join(", ");
    if (g !== w) throw new InvalidAnswer(`${what}: expected exactly [${w}], got [${g}]`);
  };
  return (v, p) => {
    const w = shape(v, p);
    exactly("rules", w.rules.map((r) => r.rule), facts.rules.map((r) => r.id));
    exactly("findings", w.findings.map((f) => f.scenario), facts.findings.map((f) => f.scenario.id));
    exactly("conflicts", w.conflicts.map((c) => c.rule), facts.conflicts.map((c) => c.rule));
    for (const r of w.rules) {
      const own = facts.verdicts[r.rule]!.toLowerCase();
      const other = [...r.text.matchAll(VERDICT_WORD)].map((m) => m[1]!.toLowerCase()).find((x) => x !== own);
      if (other) throw new InvalidAnswer(`rules: the passage for ${r.rule} says "${other}", but ${r.rule} is ${facts.verdicts[r.rule]}`);
    }
    return w;
  };
}

function prompt(facts: ReportFacts): string {
  const leadsPerRule = Object.fromEntries(facts.rules.map((r) => [r.id, facts.leads.filter((l) => l.rule === r.id).length]));
  const data = {
    contract: facts.contractPath,
    rules: facts.rules.map((r) => ({ id: r.id, text: r.text, verdict: facts.verdicts[r.id] })),
    findings: facts.findings.map((f) => ({
      scenario: f.scenario.id,
      rule: f.scenario.rule,
      bugClass: f.scenario.bugClass,
      setup: f.scenario.setup,
      call: f.scenario.call,
      before: f.outcome.observations.before,
      after: f.outcome.observations.after,
      failedReceipts: f.outcome.observations.failedReceipts,
    })),
    conflicts: facts.conflicts.map((c) => ({
      rule: c.rule,
      finding: c.finding,
      outcome: c.outcome,
      refinements: c.refinements.length,
      whyTheyDisagreed: c.explanation,
      counterexample: c.afterRefinement?.counterexample?.check.accepted
        ? { confirmedByLean: true, steps: c.afterRefinement.counterexample.path, samePathAsFinding: c.afterRefinement.counterexample.samePath }
        : null,
    })),
    leadsPerRule,
  };
  return `You are the Reporter. Write the plain-English parts of an Audit report for the owner of a NEAR smart contract,
who does not read Rust or Lean. These are the Audit's results, as the Referee settled them:

${JSON.stringify(data, null, 1)}

What the words mean: a Rule is Broken when an attack Scenario, re-run by the Referee in a sandbox, broke it (a Finding).
It is Proven when Lean accepted a proof of it against a Lean description of the contract and no Finding stands against it.
It is Unproven when there is neither. A Conflict is a Rule that was both broken in the sandbox and proven against the
description: it shows the description was too simple, and the description was then refined.

Write:
- summary: three to five sentences on the overall result.
- rules: for EVERY Rule, one or two sentences saying what the Rule protects and what its verdict means for the owner.
  Use only that Rule's own verdict word.
- findings: for EVERY Finding, two to four sentences on what the Scenario did and what went wrong, using the before
  and after values and failed receipts given.
- conflicts: for EVERY Conflict, two or three sentences on what it showed.
Use only the facts above. Do not suggest fixes, rate severity, guess at causes not shown, or mention anything else.
The verdicts, calls, commands, Leads and costs are added to the report by code; do not repeat lists of them.

Answer with JSON only:
{"summary":"...","rules":[{"rule":"R1","text":"..."}],"findings":[{"scenario":"S1","text":"..."}],"conflicts":[{"rule":"R1","text":"..."}]}`;
}

/** Asks the Reporter for its words. Null when it gives no valid answer after its retries (or at the spend cap). */
export function reporter(ctx: AskContext, facts: ReportFacts): Promise<ReportWords | null> {
  return askStructured(ctx, "reporter", prompt(facts), wordsFor(facts));
}

/** The report, in Markdown: the Reporter's words set among facts written by code. */
export function renderReport(facts: ReportFacts, words: ReportWords, costs: { totalUsd: number; capUsd: number; byAgent: Record<string, number> }): string {
  const out: string[] = [];
  const folder = facts.folder ?? "<the Audit's folder>";
  const usd = (n: number) => `$${n.toFixed(4)}`;

  out.push(`# NearWatch Audit report: ${facts.contractPath}`, "");
  out.push(
    "_The summary and the passages under each heading are worded by the Reporter, an LLM, from the Referee's result. The verdicts, calls, commands, Leads and costs are filled in by code._",
    "",
  );
  out.push(words.summary.trim(), "");

  out.push("## Verdicts", "");
  out.push("| Rule | Verdict |", "| --- | --- |");
  for (const r of facts.rules) out.push(`| ${r.id} | ${facts.verdicts[r.id]} |`);
  out.push("");
  for (const r of facts.rules) {
    out.push(`### ${r.id}: ${facts.verdicts[r.id]}`, "", `> ${r.text}`, "");
    out.push(words.rules.find((x) => x.rule === r.id)!.text.trim(), "");
  }

  out.push("## Findings", "");
  if (facts.findings.length === 0) out.push("None. No Scenario broke a Rule when the Referee re-ran it.", "");
  for (const f of facts.findings) {
    const c = f.scenario.call;
    out.push(`### ${f.scenario.id}, against ${f.scenario.rule} (${f.scenario.bugClass})`, "");
    out.push(words.findings.find((x) => x.scenario === f.scenario.id)!.text.trim(), "");
    out.push(`- Call: \`${c.as}\` calls \`${c.method}(${JSON.stringify(c.args)})\` with ${c.deposit} yoctoNEAR attached.`);
    out.push(`- Before: \`${JSON.stringify(f.outcome.observations.before)}\``);
    out.push(`- After: \`${JSON.stringify(f.outcome.observations.after)}\``);
    const failed = f.outcome.observations.failedReceipts;
    out.push(`- Failed receipts: ${failed.length ? failed.map((x) => `\`${x}\``).join("; ") : "none"}`);
    out.push(`- Re-run it in a fresh sandbox: \`npm run scenario -- ${folder}/scenarios/${f.scenario.id}.json\``, "");
  }

  out.push("## Conflicts", "");
  if (facts.conflicts.length === 0) out.push("None. No Rule was both broken in the sandbox and proven in Lean.", "");
  for (const c of facts.conflicts) {
    const n = c.refinements.length;
    const outcome =
      c.outcome === "resolved"
        ? `resolved: the old proof no longer passes against Refinement ${n}`
        : c.outcome === "withdrawn"
          ? `the proof still passed after ${n} Refinements and was withdrawn`
          : "unresolved: no Refinement compiled";
    out.push(`### ${c.rule}: Finding ${c.finding} against an accepted proof`, "");
    out.push(words.conflicts.find((x) => x.rule === c.rule)!.text.trim(), "");
    out.push(`- Outcome: ${outcome}.`);
    const cx = c.afterRefinement?.counterexample;
    if (cx?.check.accepted) {
      const same = cx.samePath === null ? "not compared with the Finding" : cx.samePath ? "follows the same path as the Finding" : "does not follow the Finding's path";
      out.push(`- Counterexample: Lean confirms the restated Property is false for concrete values; it ${same} (compared by an LLM).`);
    } else if (c.afterRefinement?.proof?.accepted) out.push("- The Prover proved the restated Property: the Refinement does not show the Finding either.");
    out.push(`- ${c.rule} is Broken regardless: a Finding outranks a proof.`, "");
  }

  out.push("## What a proof covers", "");
  out.push(
    "A Proven verdict means Lean accepted a proof of the Rule's Property against the Formalization: a description of the contract in Lean, written by the Rules agent from reading the code. The proof covers that description, not the contract's code. Where the description is simpler than the contract, a proof can pass while the contract breaks the Rule; a Conflict is how NearWatch catches that, and only when the Attacker finds the break.",
    "",
  );

  out.push("## Leads", "");
  out.push("Leads are not Findings: nothing here was shown to break a Rule. They are the Scenarios that did not, and the kinds of bug the Attacker set aside, with its reason.", "");
  if (facts.leads.length === 0) out.push("None.");
  for (const l of facts.leads) {
    const s = l.scenario;
    out.push(s ? `- ${l.rule}, ${s.id} (${s.bugClass}): \`${s.call.as}\` calls \`${s.call.method}\`; ${l.reason}.` : `- ${l.rule}: ${l.reason}`);
  }
  out.push("");

  out.push("## Cost", "");
  out.push(`The Audit's LLM calls cost ${usd(costs.totalUsd)} in all (cap $${costs.capUsd.toFixed(2)}), including this report.`, "");
  out.push("| Agent | Cost |", "| --- | --- |");
  for (const [agent, n] of Object.entries(costs.byAgent)) out.push(`| ${agent} | ${usd(n)} |`);
  out.push("");
  if (facts.proofAttempts.length > 0) {
    out.push("Each proof attempt:", "");
    out.push("| Rule | Against | Rounds | Cost | Time | Ended with |", "| --- | --- | --- | --- | --- | --- |");
    for (const a of facts.proofAttempts) {
      const against = a.step === "proof" ? "first Formalization" : "Refinement";
      out.push(`| ${a.rule} | ${against} | ${a.rounds} | ${usd(a.usd)} | ${(a.ms / 1000).toFixed(1)} s | ${a.ended} |`);
    }
    out.push("");
  }
  return `${out.join("\n").trimEnd()}\n`;
}
