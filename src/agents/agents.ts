// The Scout and the Rules agent (the Attacker is in attacker.ts). Each is a function from typed
// inputs to typed outputs; the prompt wording is a first draft and is not tested.

import type { Finding, Property, Rule, ScoutMap } from "../domain.ts";
import type { Toolchain } from "../ports.ts";
import { screenLeanText } from "../proof-rules.ts";
import { formalizationAnswer, refinementAnswer, rulesAnswer, scoutMap } from "../schemas.ts";
import type { Check } from "../validate.ts";
import { type AskContext, askStructured } from "./ask.ts";
import { BUG_CLASSES } from "./attacker.ts";

export interface Formalization {
  formalization: string;
  properties: Property[];
}

export function scout(ctx: AskContext, source: string): Promise<ScoutMap | null> {
  return askStructured(
    ctx,
    "scout",
    `You are the Scout. Map where money enters, sits and leaves this NEAR contract, and who can change it.
Answer with JSON only, in exactly this shape (every list item in moneyMethods and balanceStorage is a plain string, not an object):
{"moneyMethods":["<method>: <how money moves through it>"],"balanceStorage":["<field>: <what it records>"],"privilegedMethods":[{"method":"<method>","whoMayCall":"<who>"}],"standingNote":"<text>"}
The standingNote must say that key and upgrade control has to be checked on the deployed account.

Contract source:
${source}`,
    scoutMap,
  );
}

export async function rulesAgent(ctx: AskContext, source: string, map: ScoutMap): Promise<Rule[]> {
  const answer = await askStructured(
    ctx,
    "rules",
    `You are the Rules agent. Write the Rules this contract must always keep, in plain English, each with a Rule check:
a comparison over sandbox observations that is TRUE WHEN THE RULE HAS BEEN BROKEN.
A Rule check is about ONE contract call. An attacker builds Scenarios: some setup (creating accounts, deposits, any calls),
then "before" is observed, then exactly one call under test runs, then "after" is observed. Gas refunds and returned
deposits have landed by each observation, and an ordinary call costs well under 0.01 NEAR of gas.
A Scenario whose observations make the check TRUE is reported as proof the Rule is broken.

A Rule check has:
- "methods": the contract methods the Rule is about. The call under test must be one of them.
- "slots": the values it reads. Each slot is {"name":<name>,"kind":"view"|"balance","describe":<what it is>,"bind":<what to read>}.
  "view" reads a contract view method: "bind":{"view":{"method":<view method>,"args":{...}}}.
  "balance" reads an account's NEAR balance in yoctoNEAR: "bind":{"account":<account>}.
  You write the bindings, not the attacker. In an account, or a string view argument, use a reference to the call under test:
  "$caller" (the account that signs it), "$contract" (the contract's own account) or "$arg:<name>" (that argument of the call,
  for example "$arg:receiver_id"). Any other string is a fixed account name the attacker's setup must create.
- "condition": built only from these forms:
  {"compare":"<"|"<="|"=="|"!="|">="|">","left":<expr>,"right":<expr>}  (use these symbols, never words like "lt")
  {"all":[<condition>,...]}  {"any":[<condition>,...]}
  where <expr> is {"slot":<slot name>,"when":"before"|"after"}, {"number":"<decimal integer string>"}, or {"op":"add"|"sub","left":<expr>,"right":<expr>},
  or {"account":<a reference such as "$caller", or an account name>}, which may only be compared with "==" or "!=" against
  another account or a view slot whose view returns an account.
  Every slot the condition uses must be declared in "slots". Booleans read as 1 (true) and 0 (false).

A Rule check must stay FALSE whenever the contract behaves correctly, whatever setup and call arguments the attacker picks:
- Bind each slot to exactly the account or value the Rule is about, through the references above.
- A Rule that applies only in some situation (for example while deposits are paused) must test that situation in the
  condition itself (for example, the paused flag is true before the call).
- A Rule about who may call a method must test the signer in the condition, or the check also turns true when the
  account that is allowed makes the call. Read the allowed account through a view slot and compare, for example
  {"compare":"!=","left":{"account":"$caller"},"right":{"slot":"owner","when":"before"}}.
- Allow for gas wherever a NEAR balance is compared: the signer of the call pays gas even when the call fails, and the
  signer may also be the receiver it names. Never compare a NEAR balance with "==" or "!="; use "<" or ">" with an allowance.
The attacker will try these bug classes. Write each check so that it turns true if any of them happens to the money its Rule
protects; in particular, compare what a record loses or gains with what really arrived where it was meant to go:
${BUG_CLASSES.map((c, i) => `${i + 1}. ${c}`).join("\n")}
Do not make a check depend on the money having moved: when a transfer or cross-contract call fails, NEAR may come back to
the contract, and a record changed for money that never arrived where it was meant to go is exactly a break.
Cover every method the Scout's map lists as moving money: for each one, at least one Rule must say that the change it makes
to recorded balances is matched by real NEAR moving to or from the right account.
Write at most 5 Rules: the ones that matter most for the money this contract holds.

Example of the format only (an unrelated voting contract, not a Rule for this one):
{"rules":[{"id":"R1","text":"One vote call adds at most one vote to the proposal it names.",
 "check":{"methods":["vote"],
 "slots":[{"name":"votes","kind":"view","describe":"votes on the proposal being voted on","bind":{"view":{"method":"get_votes","args":{"proposal_id":"$arg:proposal_id"}}}}],
 "condition":{"compare":">","left":{"op":"sub","left":{"slot":"votes","when":"after"},"right":{"slot":"votes","when":"before"}},"right":{"number":"1"}}}}]}

Answer with JSON only, in that shape, with ids R1, R2, ...

Scout's map:
${JSON.stringify(map, null, 2)}

Contract source:
${source}`,
    rulesAnswer,
  );
  return answer?.rules ?? [];
}

/** Times the Rules agent may rewrite a Formalization whose statements Lean does not compile. */
export const FORMALIZATION_RETRIES = 2;

const LEAN_EXAMPLE = `abbrev Account := String

structure State where
  votes : Nat → Nat
  voted : Account → Bool

inductive Call where
  | vote (caller : Account) (proposal : Nat)

def step (s : State) : Call → State
  | .vote c p =>
      if s.voted c then s
      else { s with votes := fun q => if q = p then s.votes q + 1 else s.votes q,
                    voted := fun a => if a = c then true else s.voted a }`;

/**
 * The Rules agent's second answer: one Formalization of the contract, in which every contract call is one
 * indivisible step (docs/adr/0001), and a Property for each Rule. Every Property statement must compile
 * against the Formalization before the Prover starts; if one does not, the agent is given Lean's errors and
 * tries again, up to FORMALIZATION_RETRIES times. Null when it never produced one that compiles.
 */
export async function formalize(
  ctx: AskContext,
  toolchain: Pick<Toolchain, "checkLean">,
  source: string,
  map: ScoutMap,
  rules: Rule[],
): Promise<Formalization | null> {
  const prompt = `You are the Rules agent. You have written these Rules for a NEAR contract:
${rules.map((r) => `${r.id}: ${r.text}`).join("\n")}

Now write them in Lean 4, so that another agent can try to prove them. Write:
1. One Formalization of the contract: a small model of it in plain Lean 4.35, with no imports and no Mathlib. It must define
   - "structure State": everything the contract records, plus, for each account, the total NEAR it has deposited and the
     total NEAR it has received from the contract (kept so that Rules about money can be stated).
     Use Nat for amounts (yoctoNEAR) and String for accounts; a map is a function such as "Account → Nat".
   - "inductive Call": one constructor per contract method that can change State, taking the signing account first, then
     the method's arguments, then the attached deposit if the method accepts one.
   - "def step (s : State) : Call → State": what one call does.
   Every contract call is ONE indivisible step, even where the code is asynchronous: a transfer or cross-contract call the
   method schedules is treated as completing within that same step. A call the contract would reject leaves State unchanged.
   Write only plain definitions (abbrev, def, structure, inductive). Never use axiom, sorry, #-commands,
   set_option, import, macros, syntax, elab, IO or unsafe code.
2. One Property for each Rule: a Lean proposition about the Formalization (only the statement: no "theorem", no name, no
   proof) that says what the Rule says, as faithfully as the Formalization allows. State it about one step, for example
   "∀ (s : State) (c : Call) ..., <what must hold between s and step s c>". Do not weaken a Property to make it easier to prove.

Example of the format only (an unrelated voting contract):
{"formalization":${JSON.stringify(LEAN_EXAMPLE)},
 "properties":[{"rule":"R1","statement":"∀ (s : State) (c : Call) (p : Nat), (step s c).votes p ≤ s.votes p + 1"}]}

Answer with JSON only, in that shape, with one Property for each of ${rules.map((r) => r.id).join(", ")}.

Scout's map:
${JSON.stringify(map, null, 2)}

Contract source:
${source}`;

  const answer = await untilItCompiles(ctx, toolchain, prompt, formalizationAnswer(rules.map((r) => r.id)), (a) => a, "every Property");
  if (answer) ctx.log(`  Formalization compiles (${answer.formalization.split("\n").length} lines), with ${answer.properties.length} Properties.`);
  else ctx.log(`  The Rules agent wrote no Formalization that compiles after ${FORMALIZATION_RETRIES} retries; there is nothing to prove.`);
  return answer;
}

/**
 * Asks the Rules agent until its Formalization and statements compile, giving it Lean's errors each
 * time, up to FORMALIZATION_RETRIES retries. Null when it never wrote one that compiles.
 */
async function untilItCompiles<T>(
  ctx: AskContext,
  toolchain: Pick<Toolchain, "checkLean">,
  prompt: string,
  check: Check<T>,
  toFormalization: (answer: T) => Formalization,
  what: string,
): Promise<Formalization | null> {
  let current = prompt;
  for (let attempt = 0; attempt <= FORMALIZATION_RETRIES; attempt++) {
    const answer = await askStructured(ctx, "rules", current, check);
    if (!answer) return null;
    const f = toFormalization(answer);
    const problem = await compileProblem(toolchain, f);
    if (!problem) return f;
    ctx.log(`  Formalization attempt ${attempt + 1} does not compile: ${problem.split("\n")[0]}`);
    current = `${prompt}

Your previous answer:
${JSON.stringify(answer)}

It was rejected: ${problem}
Fix it and answer again with the whole Formalization and ${what}, as JSON only.`;
  }
  return null;
}

/** What the Rules agent is told about a Conflict. */
export interface ConflictBrief {
  rule: Rule;
  /** The first Formalization and its Property for this Rule, against which Lean accepted `proof`. */
  formal: Formalization;
  proof: string;
  finding: Finding;
  /** Earlier Refinements of this Conflict, each of which the old proof still passed. */
  earlier: Formalization[];
}

/**
 * A Refinement (docs/adr/0001): the Rules agent's Formalization once more, with only the call the Finding
 * went through split into a start step and a resolve step with a success and a failure branch, and the
 * Rule's Property restated only as much as the new steps require. It must compile, like the first one.
 */
export async function refine(ctx: AskContext, toolchain: Pick<Toolchain, "checkLean">, source: string, brief: ConflictBrief): Promise<Formalization | null> {
  const { rule, formal, proof, finding, earlier } = brief;
  const method = finding.scenario.call.method;
  const property = formal.properties.find((p) => p.rule === rule.id)!;
  const o = finding.outcome.observations;
  const latest = earlier.at(-1);
  const prompt = `You are the Rules agent. There is a Conflict on ${rule.id}: ${rule.text}
The Referee ran a Scenario against the real contract in the sandbox and it broke ${rule.id} (a Finding), yet Lean accepted a
proof of ${rule.id}'s Property against your Formalization. So your Formalization does not match the contract.

The Finding, ${finding.scenario.id}:
  setup: ${JSON.stringify(finding.scenario.setup)}
  call under test: ${JSON.stringify(finding.scenario.call)}
  observed before: ${JSON.stringify(o.before)}
  observed after: ${JSON.stringify(o.after)}
  failed receipts: ${o.failedReceipts.length ? o.failedReceipts.join("; ") : "none"}

Your Formalization, in which every call is one indivisible step:
${formal.formalization.trimEnd()}

${rule.id}'s Property: ${property.statement}
The proof Lean accepted:
${proof}
${
  latest
    ? `
Your previous Refinement (number ${earlier.length}) still let that proof pass, so it does not yet show what the Finding shows:
${latest.formalization.trimEnd()}
Property: ${latest.properties[0]!.statement}
`
    : ""
}
Write a Refinement: the same Formalization with ONLY the call "${method}" made more detailed.
- Replace its one step with a start step and a resolve step. The start step is what the call does when it runs, up to
  scheduling its transfer or cross-contract call; record what it scheduled in State (for example the pending transfers).
  The resolve step settles one pending transfer and has two branches: success (the money arrives where it was sent) and
  failure (it does not arrive and comes back to the contract, and the contract does only what its code does on failure:
  if it has no callback, its records do not change).
- Make the start and the resolve each a constructor of Call, and keep "def step (s : State) : Call → State" as the one step
  function. Keep every other call, field and definition as it is. Model what the code does; do not fix the contract.
- Restate ${rule.id}'s Property only as much as the new steps require (unchanged, if it still compiles). It must still say
  what the Rule says, and must not be weakened.
Write only plain definitions (abbrev, def, structure, inductive), as before. Lean 4.35, no imports, no Mathlib.

Answer with JSON only: {"formalization":"<the whole refined Formalization>","statement":"<${rule.id}'s Property>"}

Contract source:
${source}`;

  return untilItCompiles(
    ctx,
    toolchain,
    prompt,
    refinementAnswer,
    (a) => ({ formalization: a.formalization, properties: [{ rule: rule.id, statement: a.statement }] }),
    `${rule.id}'s Property`,
  );
}

/** Why a Formalization cannot be used, or null. Each statement is compiled with a placeholder proof. */
async function compileProblem(toolchain: Pick<Toolchain, "checkLean">, f: Formalization): Promise<string | null> {
  const screened = screenLeanText(f.formalization, "the Formalization");
  if (screened) return screened;
  for (const p of f.properties) {
    const s = screenLeanText(p.statement, `the Property for ${p.rule}`);
    if (s) return s;
  }
  for (const p of f.properties) {
    const outcome = await toolchain.checkLean(f.formalization, p, "sorry");
    if (!outcome.ok) {
      return `Lean could not compile the Formalization with the Property for ${p.rule} (stated as a theorem with a placeholder proof). Lean's errors:\n${clip(outcome.errors)}`;
    }
  }
  return null;
}

/** Lean's errors, cut to a length a prompt can carry. */
export const clip = (text: string, max = 4000): string => (text.length <= max ? text : `${text.slice(0, max)}\n... (${text.length - max} more characters)`);
