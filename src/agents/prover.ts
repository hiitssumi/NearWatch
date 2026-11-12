// The Prover: for each Property, writes a proof body, has Lean check it, reads Lean's errors and tries
// again. It supplies only the proof body: the toolchain assembles the file from the Rules agent's
// Formalization and Property statement, so the Prover cannot change what is being proved. It never
// decides that a proof counts: the Referee re-checks every proof it submits.

import type { Proof, Property, Rule } from "../domain.ts";
import { assembleLeanFile, theoremName } from "../lean.ts";
import type { Toolchain } from "../ports.ts";
import { judgeLeanOutcome, screenProofBody } from "../proof-rules.ts";
import { proverAnswer } from "../schemas.ts";
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

function prompt(f: Formalization, property: Property, rule: Rule | undefined, history: Attempt[]): string {
  const marked = assembleLeanFile(f.formalization, property, "<YOUR PROOF BODY>", "end");
  const lines = marked.split("\n");
  const bodyLine = lines.findIndex((l) => l.includes("<YOUR PROOF BODY>")) + 1;
  const shown = lines.slice(0, bodyLine).join("\n");
  const earlier =
    history.length === 0
      ? ""
      : `\nYour earlier attempts (latest last) and why each failed:\n${history
          .slice(-HISTORY)
          .map((a, i) => `--- attempt ${history.length - Math.min(history.length, HISTORY) + i + 1} ---\n${a.body}\n--- failed: ${a.why}`)
          .join("\n")}\n`;
  return `You are the Prover. Prove a Property of a Lean 4 model (the Formalization) of a NEAR contract.
${rule ? `The Property states this Rule: ${rule.id}: ${rule.text}\n` : ""}
Lean 4.35 checks exactly this file, with no imports and no Mathlib (so no Mathlib tactics such as linarith, ring,
norm_num or aesop; core tactics such as intro, cases, rcases, obtain, by_cases, split, simp, simp_all, omega, decide,
unfold, exact, rfl, constructor and induction are available):

${shown}

You write only the proof body: the tactic block that replaces <YOUR PROOF BODY>, starting on line ${bodyLine} of the file
(line numbers in Lean's errors count from the first line above). It is indented for you. Do not repeat the theorem line.
Never use sorry, admit, axioms, #-commands, set_option or new declarations: a proof using them is rejected.
${earlier}
Answer with JSON only: {"proof":"<the tactic block, lines separated by \\n>"}`;
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
    const history: Attempt[] = [];
    let elapsed = 0;
    let proved = false;
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
      const { answer, tokens, usd, ms: askMs = 0 } = await ctx.llm.ask("prover", prompt(f, property, rule, history));
      charge(ctx, "prover", usd);
      const total = (ctx.tokens.prover ??= { input: 0, output: 0 });
      total.input += tokens.input;
      total.output += tokens.output;

      let roundMs = askMs;
      let body = "";
      let why: string | null;
      try {
        body = proverAnswer(parseJson(answer), "").proof;
        answered = true;
        why = screenProofBody(body);
        if (!why) {
          const outcome = await toolchain.checkLean(f.formalization, property, body);
          roundMs += outcome.ms ?? 0;
          const judged = judgeLeanOutcome(outcome);
          why = judged && !outcome.ok ? `Lean's errors:\n${clip(outcome.errors)}` : judged;
        }
      } catch (e) {
        if (!(e instanceof InvalidAnswer)) throw e;
        why = `the answer was not valid: ${e.message}`;
      }
      elapsed += roundMs;

      const cost = `${tokens.input} in, ${tokens.output} out${usd === undefined ? "" : `, $${usd.toFixed(4)}`}, ${seconds(roundMs)}`;
      ctx.log(`  ${property.rule} round ${round} (${cost}): ${why ? `rejected, ${firstLine(why)}` : "Lean accepts it -> submitted to the Referee"}`);
      if (!why) {
        proofs.push({ rule: property.rule, body });
        proved = true;
        break;
      }
      history.push({ body: body || answer, why });
    }
    if (!proved) ctx.log(`  ${property.rule}: no proof within the budget (stopped by ${stoppedBy}, ${seconds(elapsed)} used)`);
  }
  return { proofs, answered };
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** The first line of a rejection that says something: for Lean's errors, the first error line. */
function firstLine(why: string): string {
  if (!why.startsWith("Lean's errors:")) return why.split("\n")[0]!;
  const error = why.split("\n").find((l) => /error/.test(l) && l !== "Lean's errors:");
  return `Lean: ${(error ?? why.split("\n")[1] ?? "").trim().slice(0, 200)}`;
}
