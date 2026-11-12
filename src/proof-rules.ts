// The Referee's rules for proofs. Ordinary code: no LLM takes part.

import type { LeanOutcome, Property, Proof, ProofCheck } from "./domain.ts";
import type { Toolchain } from "./ports.ts";

/** The only axioms an accepted proof may depend on. */
export const STANDARD_AXIOMS: readonly string[] = ["propext", "Classical.choice", "Quot.sound"];

/** Words that only make sense as top-level commands: a body using them is trying to say something besides a proof. */
const COMMANDS =
  /(?:^|[\s;(])(theorem|lemma|axiom|def|abbrev|instance|example|opaque|structure|inductive|class|macro|macro_rules|syntax|notation|infix|infixl|infixr|prefix|postfix|elab|elab_rules|namespace|section|end|mutual|universe|variable|import|initialize|declare_syntax_cat)\b/;

function stripComments(body: string): string {
  return body.replace(/\/-[\s\S]*?-\//g, " ").replace(/--.*$/gm, "");
}

/** Rejects a proof body before Lean sees it. Returns the reason, or null if the body may be checked. */
export function screenProofBody(body: string): string | null {
  const code = stripComments(body);
  if (code.trim() === "") return "the proof body is empty";
  const placeholder = /\b(sorry|admit|sorryAx)\b/.exec(code);
  if (placeholder) return `the proof uses the placeholder \`${placeholder[1]}\``;
  if (/(?:^|\s)#[a-z_]+/.test(code)) return "the proof body contains a Lean command (#...); it may supply only a proof";
  if (/\bset_option\b/.test(code)) return "the proof body uses `set_option`; it may supply only a proof";
  const command = COMMANDS.exec(code);
  if (command) return `the proof body contains \`${command[1]}\`; it may supply only a proof, not new declarations or statements`;
  return null;
}

/**
 * Rejects LLM-written Lean that is not plain definitions and statements, before Lean sees it. Lean runs
 * code while it checks a file (`#eval` needs no imports), so a Formalization or Property statement may
 * not contain commands, imports, options, axioms, placeholders, unsafe or foreign code, or new syntax.
 * Returns the reason, or null if the text may be checked. `what` names the text in the reason.
 */
export function screenLeanText(text: string, what: string): string | null {
  const code = stripComments(text);
  const command = /(?:^|\s)(#[a-z_]+)/.exec(code);
  if (command) return `${what} contains the Lean command \`${command[1]}\`; it may contain only definitions`;
  const word =
    /\b(import|set_option|axiom|sorry|admit|sorryAx|unsafe|implemented_by|extern|initialize|builtin_initialize|macro|macro_rules|syntax|declare_syntax_cat|elab|elab_rules|run_cmd|run_tac|run_elab|IO)\b/.exec(code);
  if (word) return `${what} uses \`${word[1]}\`, which is not allowed; it may contain only plain definitions`;
  const attribute = /@\[(?!\s*(?:simp|reducible|inline)\s*\])([^\]]*)\]/.exec(code);
  if (attribute) return `${what} uses the attribute \`@[${attribute[1]}]\`; only @[simp], @[reducible] and @[inline] are allowed`;
  return null;
}

/** Judges what Lean reported. Returns the reason for rejection, or null if the proof passes. */
export function judgeLeanOutcome(outcome: LeanOutcome): string | null {
  if (!outcome.ok) return "Lean did not accept the file";
  if (outcome.axioms.includes("sorryAx")) return "Lean reports the proof uses a placeholder (sorryAx)";
  const extra = outcome.axioms.filter((a) => !STANDARD_AXIOMS.includes(a));
  if (extra.length > 0) return `the proof depends on axiom(s) outside the standard set: ${extra.join(", ")}`;
  return null;
}

/** Re-checks one submitted proof through the toolchain and applies the rules above. */
export async function checkProof(
  toolchain: Pick<Toolchain, "checkLean">,
  formalization: string,
  property: Property | undefined,
  proof: Proof,
): Promise<ProofCheck> {
  const { rule, body } = proof;
  if (!property) return { rule, body, accepted: false, reason: `no Property is stated for ${rule}` };
  const screened = screenProofBody(body);
  if (screened) return { rule, body, accepted: false, reason: screened };
  const outcome = await toolchain.checkLean(formalization, property, body);
  const judged = judgeLeanOutcome(outcome);
  return judged
    ? { rule, body, accepted: false, reason: judged, outcome }
    : { rule, body, accepted: true, reason: `Lean accepted it; axioms: ${outcome.axioms.join(", ") || "none"}`, outcome };
}
