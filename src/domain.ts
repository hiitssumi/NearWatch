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
  | { action: "view"; method: string; args: Record<string, unknown> }
  /** Marks where the "before" observations are taken. At most one per Scenario. */
  | { action: "snapshot" };

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

/** What exists in the sandbox before a Scenario's first action. */
export interface SandboxSetup {
  /** The account the contract is deployed to. */
  contract: string;
  /** Account name to balance in yoctoNEAR. */
  accounts: Record<string, string>;
  /** The call that initialises the contract, if any. */
  init: { as: string; method: string; args: Record<string, unknown> } | null;
}

export interface ObservationSet {
  views: Record<string, string>;
  balances: Record<string, string>;
}

/**
 * "before" is taken at the Scenario's snapshot action or, without one, once its opening createAccount
 * actions have run; "after" is taken when every action has run. Each key is a slot name. The harness
 * lets a few blocks pass before each, so gas refunds and returned deposits have landed.
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

/** One transfer worked out by the Ledger. "payer" means the amount goes back to the payer. */
export interface Payout {
  to: AgentName | "payer";
  /** yoctoNEAR as a decimal string. */
  yoctoNear: string;
  reason: string;
}

export interface AuditResult {
  contractPath: string;
  scoutMap: ScoutMap | null;
  rules: Rule[];
  verdicts: Record<string, Verdict>;
  findings: Finding[];
  leads: Lead[];
  tokens: Record<string, TokenUse>;
  /** Each Payout with the hash the payer returned for it. */
  payouts: (Payout & { hash: string })[];
  transcript: string[];
}

// ---- Properties and proofs ----

/** A Rule written in Lean. The statement belongs to the Rules agent; the Prover supplies only a proof body. */
export interface Property {
  rule: string;
  statement: string;
}

export interface Proof {
  rule: string;
  body: string;
}

/** What Lean said about one assembled file. `errors` is Lean's own text, unchanged. */
export interface LeanOutcome {
  ok: boolean;
  errors: string;
  axioms: string[];
}

/** The proofs submitted to the Referee, with what they are proofs about. */
export interface ProofSubmission {
  formalization: string;
  properties: Property[];
  proofs: Proof[];
}

export interface ProofCheck {
  rule: string;
  accepted: boolean;
  reason: string;
  outcome?: LeanOutcome;
}
