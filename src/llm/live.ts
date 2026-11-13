// The live LLM gateway: NEAR AI Cloud through its OpenAI-compatible chat completions API.

import type { AgentName } from "../domain.ts";
import type { LlmAnswer, LlmGateway } from "../ports.ts";
import { priceCall, type Settings } from "../settings.ts";

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export class LlmCallError extends Error {}

const SYSTEM = "You are one agent in NearWatch, an audit of a NEAR smart contract. Answer with JSON only, no prose.";
/** A call that fails on the network (or times out) is retried this many times, after 2 s and then 4 s. */
const TRANSIENT_RETRIES = 2;
/**
 * The waits before retrying a model that answers "overloaded" (429) or "unavailable" (5xx): exponential, about
 * 6.5 minutes in all. NEAR AI's models do go away for minutes at a time, and its own message asks for
 * exponential backoff; two quick retries ended a live Audit when the Attacker's model was briefly unavailable.
 */
export const OVERLOAD_WAITS_MS = [5, 10, 20, 40, 80, 120, 120].map((s) => s * 1000);
/**
 * Reasoning models can think for many minutes on a long prompt (the Rules agent has written 34k tokens).
 * Answers are streamed, so Node's own 300-second wait for response headers never applies; a call fails
 * when the whole answer takes longer than TIMEOUT_MS or nothing arrives for IDLE_MS.
 */
const TIMEOUT_MS = 15 * 60_000;
const IDLE_MS = 2 * 60_000;

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

  /** Calls one model directly, with that agent's extras when an agent is named. Used by `ask` and by the model check. */
  async askModel(model: string, prompt: string, agent?: AgentName): Promise<LlmAnswer> {
    const label = agent ?? model;
    const price = this.settings.prices[model];
    if (!price) throw new LlmCallError(`No price for model "${model}" in settings; refusing to call it.`);

    const body = JSON.stringify({
      ...this.settings.requestExtras?.[model],
      // An agent's own extras apply on top of its model's.
      ...(agent ? this.settings.requestExtras?.[agent] : undefined),
      model,
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: prompt },
      ],
    });

    let busy = 0;
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      const idle = new AbortController();
      let idleTimer = setTimeout(() => idle.abort(new Error(`no data for ${IDLE_MS / 1000} s`)), IDLE_MS);
      const touch = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => idle.abort(new Error(`no data for ${IDLE_MS / 1000} s`)), IDLE_MS);
      };
      const signal = AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), idle.signal]);
      let parsed: { answer: string; tokens: { input: number; output: number } };
      try {
        res = await this.fetch(`${this.settings.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${this.settings.nearAiKey}` },
          body,
          signal,
        });
        if (res.ok) parsed = await readAnswer(res, touch);
      } catch (e) {
        clearTimeout(idleTimer);
        if (attempt < TRANSIENT_RETRIES) {
          await this.sleep(2000 * (attempt + 1));
          continue;
        }
        throw new LlmCallError(`${label}: call to ${model} failed: ${(e as Error).message}`);
      }

      clearTimeout(idleTimer);
      if (!res.ok) {
        const detail = (await res.text().catch(() => "")).slice(0, 300);
        if ((res.status === 429 || res.status >= 500) && busy < OVERLOAD_WAITS_MS.length) {
          await this.sleep(OVERLOAD_WAITS_MS[busy++]!);
          attempt--; // A busy model's waits do not use up the network retries.
          continue;
        }
        const tried = busy > 0 ? ` (after ${busy} retries over ${Math.round(OVERLOAD_WAITS_MS.slice(0, busy).reduce((a, b) => a + b, 0) / 1000)} s)` : "";
        throw new LlmCallError(`${label}: ${model} answered HTTP ${res.status}${tried}: ${detail}`);
      }

      const { answer, tokens } = parsed!;
      return { answer, tokens, usd: priceCall(price, tokens), model };
    }
  }
}

type Usage = { prompt_tokens?: number; completion_tokens?: number };

/**
 * Reads a chat completion: a server-sent event stream (what we ask for), or a plain JSON body (servers
 * that ignore `stream`, and the tests' fakes). `touch` is called whenever data arrives.
 */
async function readAnswer(res: Response, touch: () => void): Promise<{ answer: string; tokens: { input: number; output: number } }> {
  const tokensOf = (u?: Usage) => ({ input: u?.prompt_tokens ?? 0, output: u?.completion_tokens ?? 0 });
  if (!(res.headers.get("content-type") ?? "").includes("text/event-stream")) {
    const json = (await res.json()) as { choices?: { message?: { content?: string | null } }[]; usage?: Usage };
    return { answer: json.choices?.[0]?.message?.content ?? "", tokens: tokensOf(json.usage) };
  }
  let answer = "";
  let usage: Usage | undefined;
  let buffer = "";
  const decoder = new TextDecoder();
  const take = (line: string) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (data === "" || data === "[DONE]") return;
    const event = JSON.parse(data) as { choices?: { delta?: { content?: string | null } }[]; usage?: Usage | null };
    answer += event.choices?.[0]?.delta?.content ?? "";
    if (event.usage) usage = event.usage;
  };
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    touch();
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop()!;
    lines.forEach(take);
  }
  take(buffer);
  return { answer, tokens: tokensOf(usage) };
}
