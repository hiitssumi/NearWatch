// Replay with verification: every Scenario is re-run in the real sandbox and every Lean file re-checked by the
// real Lean, and each result is compared with the one the Recording holds. The LLM answers still come from the
// Recording. Any difference fails the replay, naming the Scenario or proof, so a stale or doctored Recording
// cannot pass.

import type { LeanOutcome, Property, RuleCheck, Scenario, ScenarioOutcome } from "../domain.ts";
import type { Toolchain } from "../ports.ts";
import { type Recording, ReplayError, type ToolchainEntry } from "./recording.ts";

/** A re-run that did not match the Recording. */
export class VerificationError extends Error {}

/** Where two values first differ, as "path: recorded X, re-run Y"; null when they are the same. */
export function firstDifference(recorded: unknown, rerun: unknown, path = ""): string | null {
  if (recorded === rerun) return null;
  const both = (test: (x: unknown) => boolean) => test(recorded) && test(rerun);
  if (both(Array.isArray)) {
    const [a, b] = [recorded as unknown[], rerun as unknown[]];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const d = firstDifference(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (both((x) => typeof x === "object" && x !== null && !Array.isArray(x))) {
    const [a, b] = [recorded as Record<string, unknown>, rerun as Record<string, unknown>];
    for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      const d = firstDifference(a[key], b[key], path ? `${path}.${key}` : key);
      if (d) return d;
    }
    return null;
  }
  const show = (x: unknown) => (x === undefined ? "nothing" : JSON.stringify(x).slice(0, 200));
  return `${path || "value"}: recorded ${show(recorded)}, re-run ${show(rerun)}`;
}

export class VerifyingToolchain implements Toolchain {
  private readonly scenarios: ToolchainEntry[];
  private readonly lean: ToolchainEntry[];
  private readonly real: Toolchain;
  private readonly onCheck: (line: string) => void;
  /** How many Scenario runs and Lean checks have been re-run and found to match. */
  readonly verified = { scenarios: 0, lean: 0 };
  /**
   * The first mismatch. Agents treat a Scenario that throws as one that "could not be run" and carry on, so
   * the mismatch is kept here: after it nothing more is re-run, and `run` reports it whatever else happened.
   */
  private failure: VerificationError | null = null;

  private fail(message: string): never {
    this.failure ??= new VerificationError(message);
    throw this.failure;
  }

  /** Runs a replay that uses this toolchain. Fails with the first mismatch, or if any recorded outcome was never re-run. */
  async run<T>(replay: () => Promise<T>): Promise<T> {
    let result: T;
    try {
      result = await replay();
    } catch (e) {
      throw this.failure ?? e;
    }
    if (this.failure) throw this.failure;
    const left = this.scenarios.length - this.verified.scenarios + (this.lean.length - this.verified.lean);
    if (left > 0) this.fail(`The Recording holds ${left} toolchain outcome(s) that this replay never asked for, so they were not verified.`);
    return result;
  }

  constructor(recorded: Recording["toolchain"], real: Toolchain, onCheck: (line: string) => void = () => {}) {
    this.scenarios = recorded.filter((e) => e.op === "runScenario");
    this.lean = recorded.filter((e) => e.op === "checkLean");
    this.real = real;
    this.onCheck = onCheck;
  }

  async runScenario(contractPath: string, scenario: Scenario, check: RuleCheck): Promise<ScenarioOutcome> {
    if (this.failure) throw this.failure;
    const n = this.verified.scenarios + 1;
    const stored = this.scenarios[n - 1];
    if (!stored || stored.op !== "runScenario" || stored.scenario !== scenario.id) {
      throw new ReplayError(`Replay asked for Scenario run #${n} (Scenario "${scenario.id}"), but the Recording does not hold it there.`);
    }
    const what = `Scenario ${scenario.id} (run #${n} of ${this.scenarios.length})`;
    let rerun: { outcome: ScenarioOutcome } | { error: string };
    try {
      rerun = { outcome: await this.real.runScenario(contractPath, scenario, check) };
    } catch (e) {
      rerun = { error: e instanceof Error ? e.message : String(e) };
    }
    const recorded = "error" in stored ? { error: stored.error } : { outcome: stored.outcome };
    const difference = firstDifference(recorded, rerun);
    if (difference) this.fail(`${what} does not match the Recording when re-run in the sandbox. ${difference}`);
    this.verified.scenarios = n;
    this.onCheck(`  re-ran ${what} in the sandbox: matches the Recording`);
    if ("error" in stored) throw new Error(stored.error);
    return stored.outcome;
  }

  async checkLean(formalization: string, property: Property, proofBody: string): Promise<LeanOutcome> {
    if (this.failure) throw this.failure;
    const n = this.verified.lean + 1;
    const stored = this.lean[n - 1];
    if (!stored || stored.op !== "checkLean" || stored.property !== property.rule) {
      throw new ReplayError(`Replay asked for Lean check #${n} (the proof of ${property.rule}), but the Recording does not hold it there.`);
    }
    const what = `the Lean check of ${property.rule} (check #${n} of ${this.lean.length})`;
    const rerun = await this.real.checkLean(formalization, property, proofBody);
    // How long the check took is not part of what Lean said.
    const said = ({ ok, errors, axioms }: LeanOutcome) => ({ ok, errors: errors.trim(), axioms });
    const difference = firstDifference(said(stored.outcome), said(rerun));
    if (difference) this.fail(`${what} does not match the Recording when re-checked with Lean. ${difference}`);
    this.verified.lean = n;
    this.onCheck(`  re-checked ${what.replace(/^the /, "")}: matches the Recording`);
    // The recorded outcome is returned, with its recorded time, so the transcript is the Recording's own.
    return stored.outcome;
  }
}
