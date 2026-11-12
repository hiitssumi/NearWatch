// The live LLM gateway: NEAR AI Cloud through its OpenAI-compatible chat completions API.

import type { AgentName } from "../domain.ts";
import type { LlmAnswer, LlmGateway } from "../ports.ts";
import { priceCall, type Settings } from "../settings.ts";

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export class LlmCallError extends Error {}

const SYSTEM = "You are one agent in NearWatch, an audit of a NEAR smart contract. Answer with JSON only, no prose.";
/** Transient failures (rate limit, server error, network) are retried this many times. */
const TRANSIENT_RETRIES = 2;
const TIMEOUT_MS = 5 * 60_000;

export interface LiveGatewayOptions {
  fetch?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
}

export class LiveGateway implements LlmGateway {
  private readonly settings: Pick<Settings, "nearAiKey" | "baseUrl" | "models" | "prices"> & Partial<Pick<Settings, "requestExtras">>;
  private readonly fetch: FetchFn;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(settings: Pick<Settings, "nearAiKey" | "baseUrl" | "models" | "prices"> & Partial<Pick<Settings, "requestExtras">>, options: LiveGatewayOptions = {}) {
    this.settings = settings;
    this.fetch = options.fetch ?? ((url, init) => fetch(url, init));
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  ask(agent: AgentName, prompt: string): Promise<LlmAnswer> {
    return this.askModel(this.settings.models[agent], prompt, agent);
  }

  /** Calls one model directly. Used by `ask` and by the model check. */
  async askModel(model: string, prompt: string, label: string = model): Promise<LlmAnswer> {
    const price = this.settings.prices[model];
    if (!price) throw new LlmCallError(`No price for model "${model}" in settings; refusing to call it.`);

    const body = JSON.stringify({
      ...this.settings.requestExtras?.[model],
      model,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: prompt },
      ],
    });

    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetch(`${this.settings.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${this.settings.nearAiKey}` },
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (e) {
        if (attempt < TRANSIENT_RETRIES) {
          await this.sleep(2000 * (attempt + 1));
          continue;
        }
        throw new LlmCallError(`${label}: call to ${model} failed: ${(e as Error).message}`);
      }

      if (!res.ok) {
        const detail = (await res.text().catch(() => "")).slice(0, 300);
        if ((res.status === 429 || res.status >= 500) && attempt < TRANSIENT_RETRIES) {
          await this.sleep(2000 * (attempt + 1));
          continue;
        }
        throw new LlmCallError(`${label}: ${model} answered HTTP ${res.status}: ${detail}`);
      }

      const json = (await res.json()) as {
        choices?: { message?: { content?: string | null } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const answer = json.choices?.[0]?.message?.content ?? "";
      const tokens = { input: json.usage?.prompt_tokens ?? 0, output: json.usage?.completion_tokens ?? 0 };
      return { answer, tokens, usd: priceCall(price, tokens), model };
    }
  }
}
