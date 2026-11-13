// The Prover: for each Property, writes a proof body, has Lean check it, reads Lean's errors and tries
// again. It supplies only the proof body: the toolchain assembles the file from the Rules agent's
// Formalization and Property statement, so the Prover cannot change what is being proved. It never
// decides that a proof counts: the Referee re-checks every proof it submits.
//
// After a Refinement it gets the restated Property once more, and may answer either with a proof or with a
// counterexample: values to apply the Property to, and tactics showing that is false. The toolchain
// assembles that file too, from the negated statement, so a counterexample cannot change the Property either.

import type { Finding, Proof, Property, Rule } from "../domain.ts";
import { assembleLeanFile, counterexampleBody, negatedProperty, theoremName } from "../lean.ts";
import type { Toolchain } from "../ports.ts";
import { judgeLeanOutcome, screenProofBody } from "../proof-rules.ts";
import { proverAnswer, type RefutationAnswer, refutationAnswer } from "../schemas.ts";
import { InvalidAnswer, parseJson } from "../validate.ts";
import { type Formalization, clip } from "./agents.ts";
import { type AskContext, charge, mayCall } from "./ask.ts";

/** Rounds per Property. */
export const PROVER_ROUNDS = 12;
/** Time per Property, counted from the recorded duration of each LLM call and Lean check. */
export const PROVER_MS = 10 * 60_000;
/** Earlier attempts shown to the Prover in each round. */
const HISTORY = 3;

export interface ProverResult {
  /** One proof body per Property the Prover's own loop got accepted. The Referee re-checks each. */
  proofs: Proof[];
  /** True when the Prover gave at least one valid answer, so it counts as having run. */
  answered: boolean;
}

interface Attempt {
  body: string;
  why: string;
}

const earlierAttempts = (history: Attempt[]): string =>
  history.length === 0
    ? ""
    : `\nYour earlier attempts (latest last) and why each failed:\n${history
        .slice(-HISTORY)
        .map((a, i) => `--- attempt ${history.length - Math.min(history.length, HISTORY) + i + 1} ---\n${a.body}\n--- failed: ${a.why}`)
        .join("\n")}\n`;

/** The file up to the line where the proof body goes, and that line's number. */
function fileUpToBody(formalization: string, property: Property, body = "<YOUR PROOF BODY>"): { shown: string; bodyLine: number } {
  const lines = assembleLeanFile(formalization, property, body, "end").split("\n");
  const bodyLine = lines.findIndex((l) => l.includes("<YOUR PROOF BODY>")) + 1;
  return { shown: lines.slice(0, bodyLine).join("\n"), bodyLine };
}

const LEAN_RULES = `Lean 4.35 checks exactly this file, with no imports and no Mathlib (so no Mathlib tactics such as linarith, ring,
norm_num or aesop; core tactics such as intro, cases, rcases, obtain, by_cases, split, simp, simp_all, omega, decide,
unfold, exact, rfl, constructor and induction are available):`;

function prompt(f: Formalization, property: Property, rule: Rule | undefined, history: Attempt[]): string {
  const { shown, bodyLine } = fileUpToBody(f.formalization, property);
  return `You are the Prover. Prove a Property of a Lean 4 model (the Formalization) of a NEAR contract.
${rule ? `The Property states this Rule: ${rule.id}: ${rule.text}\n` : ""}
${LEAN_RULES}

${shown}

You write only the proof body: the tactic block that replaces <YOUR PROOF BODY>, starting on line ${bodyLine} of the file
(line numbers in Lean's errors count from the first line above). It is indented for you. Do not repeat the theorem line.
Never use sorry, admit, axioms, #-commands, set_option or new declarations: a proof using them is rejected.
${earlierAttempts(history)}
Answer with JSON only: {"proof":"<the tactic block, lines separated by \\n>"}`;
}

/** What one round's answer came to: accepted (with what was found), or rejected with the reason. */
type Tried<T> = { ok: true; found: T; accepted: string; ms: number; valid: true } | { ok: false; why: string; shown: string; ms: number; valid: boolean };

/**
 * The Prover's rounds on one Property, within PROVER_ROUNDS, PROVER_MS and the spend cap. Each round asks
 * once, has `attempt` check the answer, and logs the round with its cost. Stops at the first accepted answer.
 */
async function rounds<T>(
  ctx: AskContext,
  rule: string,
  ask: (history: Attempt[]) => string,
  attempt: (answer: string) => Promise<Tried<T>>,
): Promise<{ found: T | null; answered: boolean; stoppedBy: string; elapsed: number }> {
  const history: Attempt[] = [];
  let elapsed = 0;
  let answered = false;
  let stoppedBy = `${PROVER_ROUNDS} rounds`;
  for (let round = 1; round <= PROVER_ROUNDS; round++) {
    if (elapsed >= PROVER_MS) {
      stoppedBy = `${PROVER_MS / 60_000} minutes`;
      break;
    }
    if (!mayCall(ctx, "prover")) {
      stoppedBy = "the spend cap";
      break;
    }
    const { answer, tokens, usd, ms: askMs = 0 } = await ctx.llm.ask("prover", ask(history));
    charge(ctx, "prover", usd);
    const total = (ctx.tokens.prover ??= { input: 0, output: 0 });
    total.input += tokens.input;
    total.output += tokens.output;

    const tried = await attempt(answer);
    if (tried.valid) answered = true;
    const roundMs = askMs + tried.ms;
    elapsed += roundMs;
    const cost = `${tokens.input} in, ${tokens.output} out${usd === undefined ? "" : `, $${usd.toFixed(4)}`}, ${seconds(roundMs)}`;
    if (tried.ok) {
      ctx.log(`  ${rule} round ${round} (${cost}): ${tried.accepted}`);
      return { found: tried.found, answered, stoppedBy, elapsed };
    }
    ctx.log(`  ${rule} round ${round} (${cost}): rejected, ${firstLine(tried.why)}`);
    history.push({ body: tried.shown || answer, why: tried.why });
  }
  return { found: null, answered, stoppedBy, elapsed };
}

/** Lean's verdict on one assembled file, as a reason for rejection or null. */
async function leanSays(toolchain: Pick<Toolchain, "checkLean">, formalization: string, property: Property, body: string): Promise<{ why: string | null; ms: number }> {
  const outcome = await toolchain.checkLean(formalization, property, body);
  const judged = judgeLeanOutcome(outcome);
  return { why: judged && !outcome.ok ? `Lean's errors:\n${clip(outcome.errors)}` : judged, ms: outcome.ms ?? 0 };
}

/** Runs the Prover's loop on every Property, in order. */
export async function prover(
  ctx: AskContext,
  toolchain: Pick<Toolchain, "checkLean">,
  f: Formalization,
  rules: Rule[],
): Promise<ProverResult> {
  const proofs: Proof[] = [];
  let answered = false;

  for (const property of f.properties) {
    const rule = rules.find((r) => r.id === property.rule);
    ctx.log(`  -- ${property.rule}: theorem ${theoremName(property.rule)} : ${property.statement} --`);
    const result = await rounds<string>(
      ctx,
      property.rule,
      (history) => prompt(f, property, rule, history),
      async (answer) => {
        let body = "";
        try {
          body = proverAnswer(parseJson(answer), "").proof;
        } catch (e) {
          if (!(e instanceof InvalidAnswer)) throw e;
          return { ok: false as const, why: `the answer was not valid: ${e.message}`, shown: answer, ms: 0, valid: false };
        }
        const screened = screenProofBody(body);
        if (screened) return { ok: false as const, why: screened, shown: body, ms: 0, valid: true };
        const { why, ms } = await leanSays(toolchain, f.formalization, property, body);
        return why ? { ok: false as const, why, shown: body, ms, valid: true } : { ok: true as const, found: body, accepted: "Lean accepts it -> submitted to the Referee", ms, valid: true };
      },
    );
    if (result.answered) answered = true;
    if (result.found !== null) proofs.push({ rule: property.rule, body: result.found });
    else ctx.log(`  ${property.rule}: no proof within the budget (stopped by ${result.stoppedBy}, ${seconds(result.elapsed)} used)`);
  }
  return { proofs, answered };
}

// ---- After a Refinement: a proof of the restated Property, or a counterexample to it ----

/** What the Prover found against a Refinement: a counterexample, a proof, or nothing within the budget. */
export type Refutation =
  | { kind: "counterexample"; witnesses: string[]; body: string; path: string }
  | { kind: "proof"; body: string }
  | { kind: "none"; stoppedBy: string };

function refutationPrompt(refined: Formalization, property: Property, rule: Rule, finding: Finding, history: Attempt[]): string {
  const proof = fileUpToBody(refined.formalization, property);
  const cx = fileUpToBody(refined.formalization, negatedProperty(property), counterexampleBody(["<VALUE 1>", "<VALUE 2>", "..."], "<YOUR PROOF BODY>"));
  const o = finding.outcome.observations;
  return `You are the Prover. The Rules agent has refined a Lean 4 model (the Formalization) of a NEAR contract, because
the Attacker broke this Rule on the real contract while a proof against the first model passed:
  ${rule.id}: ${rule.text}
The Attacker's Finding, on the real contract in a sandbox:
  call: ${JSON.stringify(finding.scenario.call)}
  before: ${JSON.stringify(o.before)}
  after: ${JSON.stringify(o.after)}
  failed receipts: ${o.failedReceipts.length ? o.failedReceipts.join("; ") : "none"}
The refined model splits ${finding.scenario.call.method} into steps, and the Rules agent restated the Property over them.

Either prove the restated Property, or, if it is false, give a COUNTEREXAMPLE: concrete values for which it is false,
checked by Lean. A counterexample that follows the Finding's path is the most useful answer.

${LEAN_RULES}

To PROVE it, your tactic block replaces <YOUR PROOF BODY> on line ${proof.bodyLine} of this file:

${proof.shown}

For a COUNTEREXAMPLE, the same Formalization is followed by this theorem instead. You give the values that replace
<VALUE 1>, <VALUE 2>, ...: one Lean term per variable the Property quantifies over, in order, then one proof per
hypothesis it assumes (often rfl). Each value is written in parentheses for you. Then your tactic block, which
replaces <YOUR PROOF BODY>, derives False from hw (for example: simp [step] at hw):

${cx.shown.slice(cx.shown.lastIndexOf("\ntheorem ") + 1)}

Never use sorry, admit, axioms, #-commands, set_option or new declarations, in a value or a tactic block.
${earlierAttempts(history)}
Answer with JSON only, one of:
  {"proof":"<the tactic block, lines separated by \\n>"}
  {"counterexample":{"witnesses":["<value 1>","<value 2>"],"proof":"<the tactic block>","path":"<one sentence: the steps the counterexample runs and what goes wrong>"}}`;
}

/**
 * After the Refinement that resolved a Conflict: the Prover's rounds on the restated Property, with the same
 * limits as a proof attempt. Each answer is checked with Lean before it is submitted to the Referee.
 */
export async function proveOrRefute(
  ctx: AskContext,
  toolchain: Pick<Toolchain, "checkLean">,
  refined: Formalization,
  rule: Rule,
  finding: Finding,
): Promise<Refutation> {
  const property = refined.properties[0]!;
  const result = await rounds<Exclude<Refutation, { kind: "none" }>>(
    ctx,
    rule.id,
    (history) => refutationPrompt(refined, property, rule, finding, history),
    async (answer) => {
      let a: RefutationAnswer;
      try {
        a = refutationAnswer(parseJson(answer), "");
      } catch (e) {
        if (!(e instanceof InvalidAnswer)) throw e;
        return { ok: false as const, why: `the answer was not valid: ${e.message}`, shown: answer, ms: 0, valid: false };
      }
      if ("proof" in a) {
        const screened = screenProofBody(a.proof);
        if (screened) return { ok: false as const, why: screened, shown: a.proof, ms: 0, valid: true };
        const { why, ms } = await leanSays(toolchain, refined.formalization, property, a.proof);
        return why
          ? { ok: false as const, why, shown: a.proof, ms, valid: true }
          : { ok: true as const, found: { kind: "proof", body: a.proof }, accepted: "a proof of the restated Property; Lean accepts it -> submitted to the Referee", ms, valid: true };
      }
      const { witnesses, proof: body, path } = a.counterexample;
      const shown = `values: ${witnesses.join(" | ")}\ntactics:\n${body}`;
      const screened = [...witnesses, body].map(screenProofBody).find((w) => w !== null);
      if (screened) return { ok: false as const, why: screened.replace(/^the proof( body)?/, "a value or the tactic block"), shown, ms: 0, valid: true };
      const { why, ms } = await leanSays(toolchain, refined.formalization, negatedProperty(property), counterexampleBody(witnesses, body));
      return why
        ? { ok: false as const, why, shown, ms, valid: true }
        : { ok: true as const, found: { kind: "counterexample", witnesses, body, path }, accepted: "a counterexample; Lean confirms it -> submitted to the Referee", ms, valid: true };
    },
  );
  if (result.found) return result.found;
  ctx.log(`  ${rule.id}: no proof and no counterexample within the budget (stopped by ${result.stoppedBy}, ${seconds(result.elapsed)} used)`);
  return { kind: "none", stoppedBy: result.stoppedBy };
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** The first line of a rejection that says something: for Lean's errors, the first error line. */
function firstLine(why: string): string {
  if (!why.startsWith("Lean's errors:")) return why.split("\n")[0]!;
  const error = why.split("\n").find((l) => /error/.test(l) && l !== "Lean's errors:");
  return `Lean: ${(error ?? why.split("\n")[1] ?? "").trim().slice(0, 200)}`;
}
