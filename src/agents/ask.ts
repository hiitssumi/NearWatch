import type { AgentName, TokenUse } from "../domain.ts";
import type { LlmGateway } from "../ports.ts";
import { type Check, InvalidAnswer, parseJson } from "../validate.ts";

export const MAX_RETRIES = 2;

export interface AskContext {
  llm: LlmGateway;
  tokens: Record<string, TokenUse>;
  log: (line: string) => void;
}

/**
 * Asks an agent for a structured answer and validates it. An invalid answer is retried up to
 * twice with the validation error appended to the prompt; after that the agent produced nothing.
 * Errors other than an invalid answer (a missing Recording exchange, a network failure) propagate.
 */
export async function askStructured<T>(ctx: AskContext, agent: AgentName, prompt: string, check: Check<T>): Promise<T | null> {
  let currentPrompt = prompt;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const { answer, tokens } = await ctx.llm.ask(agent, currentPrompt);
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
