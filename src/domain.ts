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
  /** What the slot reads. Written by the Rules agent, never by the Attacker (see SlotBinding). */
  bind: SlotBinding;
}

/**
 * `account` is an account id: a reference to the call under test ("$caller", "$contract", "$arg:<name>")
 * or a literal account name. It may only be compared, with "==" or "!=", with another account or with a
 * view slot whose view returns an account, for example to say that the signer is not the owner.
 */
export type Expr =
  | { slot: string; when: "before" | "after" }
  | { number: string }
  | { account: string }
  | { op: "add" | "sub"; left: Expr; right: Expr };

export type Condition =
  | { compare: "<" | "<=" | "==" | "!=" | ">=" | ">"; left: Expr; right: Expr }
  | { all: Condition[] }
  | { any: Condition[] };

/** True when the Rule has been broken. Evaluated by the sandbox harness, never by the caller. */
export interface RuleCheck {
  /** The contract methods the Rule is about. A Scenario's call under test must be one of them. */
  methods: string[];
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

/** The one call a Scenario is about. */
export interface CallUnderTest {
  as: string;
  method: string;
  args: Record<string, unknown>;
  deposit: string;
  gas: string;
}

/**
 * An account name, or a string view argument, may be a reference to the call under test:
 * "$caller", "$contract" or "$arg:<name>" (one of the call's string arguments). Any other string is a
 * literal account name, which the Scenario must create for the slot to read anything.
 */
export type SlotBinding =
  | { view: { method: string; args: Record<string, unknown> } }
  | { account: string };

export interface Scenario {
  id: string;
  rule: string;
  bugClass: string;
  /** Run before "before" is observed: accounts, deposits, anything the call needs. */
  setup: SandboxAction[];
  /** "before" is observed just before this call, "after" once it and every receipt it caused have landed. */
  call: CallUnderTest;
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
 * "before" is observed after the Scenario's setup, "after" after its call under test. Each key is a slot
 * name. The harness lets a few blocks pass before each, so gas refunds and returned deposits have landed.
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
  /** The Rules agent's Formalization, or null if it wrote none that compiled. */
  formalization: string | null;
  properties: Property[];
  /** The Referee's check of each proof the Prover submitted. */
  proofs: ProofCheck[];
  /** Every Conflict, at most one per Rule, with the Refinements it went through. */
  conflicts: Conflict[];
  transcript: string[];
}

// ---- Conflicts and Refinements ----

/** A Finding against a Rule whose Property also has a proof the Referee accepted. */
export interface Conflict {
  rule: string;
  /** The Finding's Scenario id. */
  finding: string;
  /** The proof the Referee accepted against the first Formalization. */
  proof: ProofCheck;
  /** Why the two disagree, worded by an LLM. It decides nothing. */
  explanation: string;
  refinements: Refinement[];
  /**
   * resolved: the old proof fails against a Refinement. withdrawn: it still passes after the last one
   * allowed. unresolved: the Rules agent wrote no Refinement that compiles. The Rule is Broken in every case.
   */
  outcome: "resolved" | "withdrawn" | "unresolved";
  /**
   * After the Refinement that resolved the Conflict, what the Prover did with the restated Property:
   * a counterexample, a proof, or nothing (absent when the step did not run). Neither changes the verdict.
   */
  afterRefinement?: { counterexample: Counterexample | null; proof: ProofCheck | null };
}

/** Concrete values, checked by Lean, for which a Property is false against a Formalization. */
export interface Counterexample {
  rule: string;
  /** The Refinement it breaks the restated Property of (1 for the first). */
  refinement: number;
  /** Lean terms the Property is applied to, in order: values for its variables and proofs of its hypotheses. */
  witnesses: string[];
  /** The tactic block that derives False from the Property applied to the witnesses. */
  body: string;
  /** The Prover's own one-line account of the steps the counterexample runs. */
  path: string;
  /** The Referee's re-check with Lean. */
  check: ProofCheck;
  /** Whether it follows the same path as the Finding. Compared by an LLM; it decides nothing. Null if not compared. */
  samePath: boolean | null;
  comparison: string;
}

/** A Formalization that splits one call into a start step and a resolve step, written after a Conflict. */
export interface Refinement {
  /** The call the Finding went through, which this Refinement splits. */
  method: string;
  formalization: string;
  /** The Rule's Property, restated for the Refinement only as much as the new steps require. */
  property: Property;
  /** The Referee's re-check of the old proof against this Refinement. */
  recheck: ProofCheck;
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
  /** How long the check took. Stored in Recordings, so a replay sees the same clock as the live run. */
  ms?: number;
}

/** The proofs submitted to the Referee, with what they are proofs about. */
export interface ProofSubmission {
  formalization: string;
  properties: Property[];
  proofs: Proof[];
}

export interface ProofCheck {
  rule: string;
  /** The proof body that was checked. */
  body: string;
  accepted: boolean;
  reason: string;
  outcome?: LeanOutcome;
}
