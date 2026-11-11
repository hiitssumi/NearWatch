// The recording LLM gateway: wraps another gateway (normally the live one) and stores every exchange.

import { execFileSync } from "node:child_process";
import type { AgentName } from "../domain.ts";
import type { LlmAnswer, LlmGateway } from "../ports.ts";
import type { Recording } from "../replay/recording.ts";

export class RecordingGateway implements LlmGateway {
  readonly exchanges: Recording["exchanges"] = [];
  private readonly inner: LlmGateway;
  constructor(inner: LlmGateway) {
    this.inner = inner;
  }

  async ask(agent: AgentName, prompt: string): Promise<LlmAnswer> {
    const result = await this.inner.ask(agent, prompt);
    this.exchanges.push({ agent, model: result.model, prompt, answer: result.answer, tokens: result.tokens, usd: result.usd });
    return result;
  }

  toRecording(parts: { commit: string; settings: Record<string, unknown>; contract: Recording["contract"] }): Recording {
    return { format: 1, ...parts, exchanges: this.exchanges, toolchain: [], payouts: [] };
  }
}

/** The commit a Recording is made from, marked "-dirty" when the working tree has changes. */
export function currentCommit(cwd?: string): string {
  try {
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8" }).trim() !== "";
    return dirty ? `${head}-dirty` : head;
  } catch {
    return "unknown";
  }
}
