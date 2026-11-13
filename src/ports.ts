import type { AgentName, LeanOutcome, Property, RuleCheck, Scenario, ScenarioOutcome, TokenUse } from "./domain.ts";

export interface LlmAnswer {
  answer: string;
  tokens: TokenUse;
  /** Dollars this call cost, priced from the table in settings. Absent when unknown (hand-made Recordings). */
  usd?: number;
  /** The model that answered. */
  model?: string;
  /** How long the call took. Stored in Recordings, so a replay sees the same clock as the live run. */
  ms?: number;
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

/** A payment that could not be made. The message says why; the Audit goes on and lists what was not paid. */
export class PaymentError extends Error {}

export interface Payer {
  readonly describe: string;
  /** True when nothing is really sent (the fake payer). */
  readonly simulated?: boolean;
  /** Where a transaction hash can be looked up: a URL that the hash is added to. */
  readonly explorer?: string;
  /** Moves the Fee from the payer's account to the parent's, before any agent runs. */
  collectFee(yoctoNear: string): Promise<{ hash: string }>;
  /** Pays one Payout from the parent's account. Throws a PaymentError when it cannot be paid. */
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
