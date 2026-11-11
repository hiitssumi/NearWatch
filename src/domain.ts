// The words in this file follow GLOSSARY.md.

export type AgentName = "scout" | "rules" | "attacker" | "prover" | "referee" | "reporter";

// ---- Scout ----

export interface ScoutMap {
  moneyMethods: string[];
  balanceStorage: string[];
  privilegedMethods: { method: string; whoMayCall: string }[];
  standingNote: string;
}

// ---- Rules and Rule checks ----

/** A value the Rule check reads, bound to a concrete observation by each Scenario. */
export interface ObservationSlot {
  name: string;
  kind: "view" | "balance";
  describe: string;
}

export type Expr =
  | { slot: string; when: "before" | "after" }
  | { number: string }
  | { op: "add" | "sub"; left: Expr; right: Expr };

export type Condition =
  | { compare: "<" | "<=" | "==" | "!=" | ">=" | ">"; left: Expr; right: Expr }
  | { all: Condition[] }
  | { any: Condition[] };

/** True when the Rule has been broken. Evaluated by the sandbox harness, never by the caller. */
export interface RuleCheck {
  slots: ObservationSlot[];
  condition: Condition;
}

export interface Rule {
  id: string;
  text: string;
  check: RuleCheck;
}

// ---- Scenarios ----

export type SandboxAction =
  | { action: "createAccount"; account: string; balance: string }
  | { action: "call"; as: string; method: string; args: Record<string, unknown>; deposit: string; gas: string }
  | { action: "view"; method: string; args: Record<string, unknown> };

export type SlotBinding =
  | { view: { method: string; args: Record<string, unknown> } }
  | { account: string };

export interface Scenario {
  id: string;
  rule: string;
  bugClass: string;
  actions: SandboxAction[];
  bind: Record<string, SlotBinding>;
}

export interface ObservationSet {
  views: Record<string, string>;
  balances: Record<string, string>;
}

/**
 * "before" is taken once the Scenario's opening createAccount actions have run, so a fresh account's
 * starting balance is visible; "after" is taken when every action has run. Each key is a slot name.
 */
export interface Observations {
  before: ObservationSet;
  after: ObservationSet;
  failedReceipts: string[];
}

export interface ScenarioOutcome {
  observations: Observations;
  ruleCheckTrue: boolean;
}

// ---- Verdicts and results ----

export type Verdict = "Broken" | "Proven" | "Unproven";

export interface Finding {
  scenario: Scenario;
  outcome: ScenarioOutcome;
}

export interface Lead {
  rule: string;
  reason: string;
  scenario?: Scenario;
}

export interface TokenUse {
  input: number;
  output: number;
}

export interface AuditResult {
  contractPath: string;
  scoutMap: ScoutMap | null;
  rules: Rule[];
  verdicts: Record<string, Verdict>;
  findings: Finding[];
  leads: Lead[];
  tokens: Record<string, TokenUse>;
  transcript: string[];
}
