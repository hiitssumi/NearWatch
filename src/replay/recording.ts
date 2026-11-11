import { readFile } from "node:fs/promises";
import type { AgentName, ScenarioOutcome, TokenUse } from "../domain.ts";
import type { AuditPorts, LlmAnswer, LlmGateway, Payer, PayoutOrder, Toolchain } from "../ports.ts";
import { scenarioOutcome } from "../schemas.ts";
import { amount, anyObject, array, type Check, object, oneOf, str } from "../validate.ts";

/** The stored answers and outcomes of one Audit, from which it can be replayed. */
export interface Recording {
  format: 1;
  commit: string;
  settings: Record<string, unknown>;
  contract: { path: string; source: string };
  /** Every LLM exchange, in order. `answer` may be stored as JSON for hand-written Recordings. */
  exchanges: { agent: AgentName; answer: string; tokens: TokenUse }[];
  /** Every toolchain outcome, in order. */
  toolchain: { op: "runScenario"; scenario: string; outcome: ScenarioOutcome }[];
  payouts: { agent: string; yoctoNear: string; hash: string }[];
}

const AGENTS = ["scout", "rules", "attacker", "prover", "referee", "reporter"] as const;
const count: Check<number> = (v, p) => {
  if (typeof v === "number" && Number.isInteger(v) && v >= 0) return v;
  throw new Error(`${p}: expected a whole number`);
};

const recordingCheck: Check<Recording> = (v, p) => {
  const r = object({
    commit: str,
    settings: anyObject,
    contract: object({ path: str, source: (x, q) => (typeof x === "string" ? x : str(x, q)) }),
    exchanges: array(
      object({
        agent: oneOf(...AGENTS),
        answer: (x, q) => (typeof x === "string" ? x : JSON.stringify(anyObject(x, q))),
        tokens: object({ input: count, output: count }),
      }),
    ),
    toolchain: array(object({ op: oneOf("runScenario"), scenario: str, outcome: scenarioOutcome })),
    payouts: array(object({ agent: str, yoctoNear: amount, hash: str })),
  })(v, p);
  if ((v as { format?: unknown }).format !== 1) throw new Error("Recording: unsupported format (expected 1)");
  return { format: 1, ...r };
};

export async function loadRecording(path: string): Promise<Recording> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (e) {
    throw new Error(`Cannot read Recording ${path}: ${(e as Error).message}`);
  }
  try {
    return recordingCheck(raw, "");
  } catch (e) {
    throw new Error(`Recording ${path} is malformed: ${(e as Error).message}`);
  }
}

export class ReplayError extends Error {}

/** Returns stored answers in order; fails clearly when asked for an exchange that is not recorded. */
export class ReplayGateway implements LlmGateway {
  private next = 0;
  private readonly exchanges: Recording["exchanges"];
  constructor(exchanges: Recording["exchanges"]) {
    this.exchanges = exchanges;
  }
  async ask(agent: AgentName, _prompt: string): Promise<LlmAnswer> {
    const n = this.next;
    const stored = this.exchanges[n];
    if (!stored) {
      throw new ReplayError(
        `Replay asked for LLM exchange #${n + 1} (agent "${agent}"), but the Recording holds only ${this.exchanges.length} exchange(s).`,
      );
    }
    if (stored.agent !== agent) {
      throw new ReplayError(
        `Replay asked for LLM exchange #${n + 1} from agent "${agent}", but the Recording has agent "${stored.agent}" there.`,
      );
    }
    this.next++;
    return { answer: stored.answer, tokens: stored.tokens };
  }
}

/** Returns stored toolchain outcomes in order; fails clearly on any mismatch. */
export class ReplayToolchain implements Toolchain {
  private next = 0;
  private readonly outcomes: Recording["toolchain"];
  constructor(outcomes: Recording["toolchain"]) {
    this.outcomes = outcomes;
  }
  async runScenario(_contractPath: string, scenario: { id: string }): Promise<ScenarioOutcome> {
    const n = this.next;
    const stored = this.outcomes[n];
    if (!stored) {
      throw new ReplayError(
        `Replay asked for toolchain outcome #${n + 1} (Scenario "${scenario.id}"), but the Recording holds only ${this.outcomes.length}.`,
      );
    }
    if (stored.scenario !== scenario.id) {
      throw new ReplayError(
        `Replay asked for toolchain outcome #${n + 1} for Scenario "${scenario.id}", but the Recording has Scenario "${stored.scenario}" there.`,
      );
    }
    this.next++;
    return stored.outcome;
  }
}

/** Records what it would send and sends nothing. */
export class FakePayer implements Payer {
  readonly describe = "fake payer (records Payouts, sends nothing)";
  readonly simulated = true;
  readonly sent: PayoutOrder[] = [];
  async send(order: PayoutOrder): Promise<{ hash: string }> {
    this.sent.push(order);
    return { hash: `fake-${this.sent.length}` };
  }
}

export function replayPorts(recording: Recording, payer: Payer = new FakePayer()): AuditPorts {
  return {
    llm: new ReplayGateway(recording.exchanges),
    toolchain: new ReplayToolchain(recording.toolchain),
    payer,
    source: { read: async () => recording.contract.source },
  };
}
