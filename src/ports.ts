import type { AgentName, LeanOutcome, Property, RuleCheck, Scenario, ScenarioOutcome, TokenUse } from "./domain.ts";

export interface LlmAnswer {
  answer: string;
  tokens: TokenUse;
}

/** One operation: given an agent name and a prompt, return an answer and its token use. */
export interface LlmGateway {
  ask(agent: AgentName, prompt: string): Promise<LlmAnswer>;
}

export interface Toolchain {
  runScenario(contractPath: string, scenario: Scenario, check: RuleCheck): Promise<ScenarioOutcome>;
  /** Assembles a Lean file from the three parts, checks it, and returns success or Lean's error text, plus the axioms used. */
  checkLean(formalization: string, property: Property, proofBody: string): Promise<LeanOutcome>;
}

export interface PayoutOrder {
  agent: AgentName | "payer";
  yoctoNear: string;
}

export interface Payer {
  readonly describe: string;
  /** True when nothing is really sent (the fake payer). */
  readonly simulated?: boolean;
  send(order: PayoutOrder): Promise<{ hash: string }>;
}

/** Reads the contract source. Live audits read the file; replay returns the recorded source. */
export interface SourceReader {
  read(contractPath: string): Promise<string>;
}

export interface AuditPorts {
  llm: LlmGateway;
  toolchain: Toolchain;
  payer: Payer;
  source: SourceReader;
}
