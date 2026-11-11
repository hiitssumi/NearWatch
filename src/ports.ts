import type { AgentName, RuleCheck, Scenario, ScenarioOutcome, TokenUse } from "./domain.ts";

export interface LlmAnswer {
  answer: string;
  tokens: TokenUse;
  /** Dollars this call cost, priced from the table in settings. Absent when unknown (hand-made Recordings). */
  usd?: number;
  /** The model that answered. */
  model?: string;
}

/** One operation: given an agent name and a prompt, return an answer and its token use. */
export interface LlmGateway {
  ask(agent: AgentName, prompt: string): Promise<LlmAnswer>;
}

export interface Toolchain {
  runScenario(contractPath: string, scenario: Scenario, check: RuleCheck): Promise<ScenarioOutcome>;
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
