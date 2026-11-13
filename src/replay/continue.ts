// Continuing an earlier live Audit: its Recording's answers and outcomes are replayed, each agent and each kind of
// toolchain outcome in its own order, and only what the Recording does not hold goes to the live model and the
// local toolchain. Used to run a step added after a live Audit was recorded without paying for the whole Audit
// again. The new Recording holds everything, says what it continued from, and replays like any other.

import type { AgentName, LeanOutcome, Property, RuleCheck, Scenario, ScenarioOutcome } from "../domain.ts";
import type { LlmAnswer, LlmGateway, Toolchain } from "../ports.ts";
import { type Recording, ReplayError } from "./recording.ts";

export class ReplayThenLive implements LlmGateway {
  private readonly queues = new Map<AgentName, Recording["exchanges"]>();
  private readonly inner: LlmGateway;
  /** Exchanges answered from the Recording, and how many of their prompts differ from the stored ones. */
  replayed = 0;
  promptsChanged = 0;
  live = 0;
  constructor(exchanges: Recording["exchanges"], inner: LlmGateway) {
    for (const e of exchanges) this.queues.set(e.agent, [...(this.queues.get(e.agent) ?? []), e]);
    this.inner = inner;
  }
  async ask(agent: AgentName, prompt: string): Promise<LlmAnswer> {
    const stored = this.queues.get(agent)?.shift();
    if (!stored) {
      this.live++;
      return this.inner.ask(agent, prompt);
    }
    this.replayed++;
    if (stored.prompt !== undefined && stored.prompt !== prompt) this.promptsChanged++;
    return { answer: stored.answer, tokens: stored.tokens, usd: stored.usd, model: stored.model, ms: stored.ms };
  }
}

export class ReplayThenLiveToolchain implements Toolchain {
  private readonly scenarios: Recording["toolchain"];
  private readonly lean: Recording["toolchain"];
  private readonly inner: Toolchain;
  replayed = 0;
  live = 0;
  constructor(outcomes: Recording["toolchain"], inner: Toolchain) {
    this.scenarios = outcomes.filter((e) => e.op === "runScenario");
    this.lean = outcomes.filter((e) => e.op === "checkLean");
    this.inner = inner;
  }
  async runScenario(contractPath: string, scenario: Scenario, check: RuleCheck): Promise<ScenarioOutcome> {
    const stored = this.scenarios.shift();
    if (!stored) {
      this.live++;
      return this.inner.runScenario(contractPath, scenario, check);
    }
    if (stored.op !== "runScenario" || stored.scenario !== scenario.id) {
      throw new ReplayError(`Continuing: Scenario "${scenario.id}" was asked for, but the Recording has another outcome there.`);
    }
    this.replayed++;
    if ("error" in stored) throw new Error(stored.error);
    return stored.outcome;
  }
  async checkLean(formalization: string, property: Property, proofBody: string): Promise<LeanOutcome> {
    const stored = this.lean.shift();
    if (!stored) {
      this.live++;
      return this.inner.checkLean(formalization, property, proofBody);
    }
    if (stored.op !== "checkLean" || stored.property !== property.rule) {
      throw new ReplayError(`Continuing: a Lean check for ${property.rule} was asked for, but the Recording has another outcome there.`);
    }
    this.replayed++;
    return stored.outcome;
  }
}
