import type { AgentName, TokenUse } from "../domain.ts";
import type { LlmGateway } from "../ports.ts";
import { type Check, InvalidAnswer, parseJson } from "../validate.ts";

export const MAX_RETRIES = 2;

/** What the Audit has spent on LLM calls, and its cap. Once spent reaches the cap, no agent is asked again. */
export interface Budget {
  capUsd: number;
  spentUsd: number;
  byAgent: Record<string, number>;
  capReached: boolean;
}

export const newBudget = (capUsd: number): Budget => ({ capUsd, spentUsd: 0, byAgent: {}, capReached: false });

/**
 * While the Attacker and the Prover run side by side, each side runs in a lane holding its own share of
 * what was left under the cap. Whether a side is stopped then depends only on its own spending, never on
 * how fast the other side spent, so a replay stops it exactly where the live run did.
 */
export interface Lane {
  name: string;
  allowanceUsd: number;
  spentUsd: number;
  capReached: boolean;
}

export const newLane = (name: string, allowanceUsd: number): Lane => ({ name, allowanceUsd, spentUsd: 0, capReached: false });

export interface AskContext {
  llm: LlmGateway;
  tokens: Record<string, TokenUse>;
  log: (line: string) => void;
  /** Absent means no spend tracking and no cap. */
  budget?: Budget;
  /** Set while agents run side by side: the share of the cap this agent's side may spend. */
  lane?: Lane;
}

/** True once this agent may make no more calls: its lane's share is spent, or (outside a lane) the cap is reached. */
export const capReached = (ctx: AskContext): boolean => (ctx.lane ? ctx.lane.capReached : (ctx.budget?.capReached ?? false));

/** Records a call's price against the budget. */
export function charge(ctx: AskContext, agent: string, usd: number | undefined): void {
  const b = ctx.budget;
  if (!b || usd === undefined) return;
  b.spentUsd += usd;
  b.byAgent[agent] = (b.byAgent[agent] ?? 0) + usd;
  if (ctx.lane) ctx.lane.spentUsd += usd;
}

/** True when the cap allows another call. Logs the moment the cap is reached, and each call it stops. */
export function mayCall(ctx: AskContext, agent: string): boolean {
  const lane = ctx.lane;
  if (lane && ctx.budget) {
    if (lane.spentUsd < lane.allowanceUsd) return true;
    if (!lane.capReached) {
      lane.capReached = true;
      ctx.log(
        `  ** Spend cap reached for the ${lane.name}: $${lane.spentUsd.toFixed(4)} of its $${lane.allowanceUsd.toFixed(2)} share. No more LLM calls on this side. **`,
      );
    }
    ctx.log(`  (spend cap: ${agent} not asked)`);
    return false;
  }
  const b = ctx.budget;
  if (!b || b.spentUsd < b.capUsd) return true;
  if (!b.capReached) {
    b.capReached = true;
    ctx.log(`  ** Spend cap reached: $${b.spentUsd.toFixed(4)} of $${b.capUsd.toFixed(2)}. No more LLM calls in this Audit. **`);
  }
  ctx.log(`  (spend cap: ${agent} not asked)`);
  return false;
}

/**
 * Asks an agent for a structured answer and validates it. An invalid answer is retried up to
 * twice with the validation error appended to the prompt; after that the agent produced nothing.
 * At the spend cap no further call is made and the agent produces nothing.
 * Errors other than an invalid answer (a missing Recording exchange, a network failure) propagate.
 */
export async function askStructured<T>(ctx: AskContext, agent: AgentName, prompt: string, check: Check<T>): Promise<T | null> {
  let currentPrompt = prompt;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (!mayCall(ctx, agent)) return null;
    const { answer, tokens, usd } = await ctx.llm.ask(agent, currentPrompt);
    charge(ctx, agent, usd);
    const total = (ctx.tokens[agent] ??= { input: 0, output: 0 });
    total.input += tokens.input;
    total.output += tokens.output;
    try {
      return check(parseJson(answer), "");
    } catch (e) {
      if (!(e instanceof InvalidAnswer)) throw e;
      ctx.log(`  (invalid answer from ${agent}: ${e.message})`);
      currentPrompt = `${prompt}\n\nYour previous answer was invalid: ${e.message}\nAnswer again with JSON only.`;
    }
  }
  ctx.log(`  ${agent} gave no valid answer after ${MAX_RETRIES} retries; it produced nothing.`);
  return null;
}
