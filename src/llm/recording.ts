// The recording LLM gateway: wraps another gateway (normally the live one) and stores every exchange.

import { execFileSync } from "node:child_process";
import type { AgentName, LeanOutcome, Property, RuleCheck, Scenario, ScenarioOutcome } from "../domain.ts";
import type { LlmAnswer, LlmGateway, Toolchain } from "../ports.ts";
import type { Recording } from "../replay/recording.ts";

export class RecordingGateway implements LlmGateway {
  readonly exchanges: Recording["exchanges"] = [];
  private readonly inner: LlmGateway;
  constructor(inner: LlmGateway) {
    this.inner = inner;
  }

  async ask(agent: AgentName, prompt: string): Promise<LlmAnswer> {
    const start = performance.now();
    const result = await this.inner.ask(agent, prompt);
    const ms = result.ms ?? Math.round(performance.now() - start);
    this.exchanges.push({ agent, model: result.model, prompt, answer: result.answer, tokens: result.tokens, usd: result.usd, ms });
    return { ...result, ms };
  }

  toRecording(parts: {
    commit: string;
    settings: Record<string, unknown>;
    contract: Recording["contract"];
    toolchain?: Recording["toolchain"];
  }): Recording {
    return { format: 1, ...parts, exchanges: this.exchanges, toolchain: parts.toolchain ?? [], payouts: [] };
  }
}

/** Wraps a toolchain and stores every outcome, including a Scenario that could not be run, in order. */
export class RecordingToolchain implements Toolchain {
  readonly entries: Recording["toolchain"] = [];
  private readonly inner: Toolchain;
  constructor(inner: Toolchain) {
    this.inner = inner;
  }

  async runScenario(contractPath: string, scenario: Scenario, check: RuleCheck): Promise<ScenarioOutcome> {
    try {
      const outcome = await this.inner.runScenario(contractPath, scenario, check);
      this.entries.push({ op: "runScenario", scenario: scenario.id, outcome });
      return outcome;
    } catch (e) {
      this.entries.push({ op: "runScenario", scenario: scenario.id, error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  }

  async checkLean(formalization: string, property: Property, proofBody: string): Promise<LeanOutcome> {
    const start = performance.now();
    const inner = await this.inner.checkLean(formalization, property, proofBody);
    const outcome = { ...inner, ms: inner.ms ?? Math.round(performance.now() - start) };
    this.entries.push({ op: "checkLean", property: property.rule, outcome });
    return outcome;
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
