// The toolchain's "check a Lean file" operation, against the local Lean install.
// The file is assembled here from three parts (Formalization, Property statement, proof body), so the
// proof body cannot alter what is being proved. Lean files are plain: no packages, no Mathlib.

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import type { LeanOutcome, Property } from "./domain.ts";

/** The name the assembled file gives the Property's theorem. */
export function theoremName(rule: string): string {
  return `property_${rule.replace(/[^A-Za-z0-9_]/g, "_")}`;
}

/**
 * Assembles the file Lean checks. The trailer, which the proof body never sees, asks Lean for the
 * axioms the theorem depends on and then prints `marker`, so an axiom report counts only when the
 * marker follows it (a body that ends the file early, or prints a fake report, gains nothing).
 */
export function assembleLeanFile(formalization: string, property: Property, proofBody: string, marker: string): string {
  const name = theoremName(property.rule);
  const body = proofBody
    .replace(/\s+$/, "")
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
  return `${formalization.replace(/\s+$/, "")}

theorem ${name} :
    ${property.statement.trim()} := by
${body}

#print axioms ${name}
#eval IO.println "${marker}"
`;
}

/** What a counterexample proves: the negation of the Property, under its own theorem name. */
export const negatedProperty = (p: Property): Property => ({ rule: `${p.rule}_counterexample`, statement: `¬ (${p.statement.trim()})` });

/**
 * The proof body Lean checks for a counterexample: it applies the Property to the witnesses, in order, and
 * leaves the Prover's tactics to derive False from that (`hw`). The witnesses are what make it concrete.
 */
export function counterexampleBody(witnesses: string[], tactics: string): string {
  const args = witnesses.map((w) => `(${w.replace(/\s*\n\s*/g, " ").trim()})`).join(" ");
  return `intro h\nhave hw := h ${args}\n${tactics.replace(/\s+$/, "")}`;
}

/** Reads the axiom list Lean printed for `name` just before `marker`; null if there is no such report. */
export function readAxiomReport(output: string, name: string, marker: string): string[] | null {
  const end = output.lastIndexOf(marker);
  if (end < 0) return null;
  const before = output.slice(0, end);
  const quoted = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`'${quoted}' (?:depends on axioms: \\[([^\\]]*)\\]|does not depend on any axioms)`, "g");
  let last: RegExpExecArray | null = null;
  for (let m = re.exec(before); m; m = re.exec(before)) last = m;
  if (!last) return null;
  return last[1] === undefined ? [] : last[1].split(",").map((a) => a.trim()).filter(Boolean);
}

/** Finds the `lean` binary: $NEARWATCH_LEAN, then PATH, then elan's default place. Null if absent. */
export function findLean(): string | null {
  const env = process.env.NEARWATCH_LEAN;
  if (env) return existsSync(env) ? env : null;
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (dir && existsSync(join(dir, "lean"))) return join(dir, "lean");
  }
  const elan = join(homedir(), ".elan", "bin", "lean");
  return existsSync(elan) ? elan : null;
}

export class LeanMissing extends Error {}

/** Checks assembled Lean files with the local Lean install. */
export class LocalLean {
  private readonly lean: string;
  private readonly timeoutMs: number;
  constructor({ lean = findLean(), timeoutMs = 300_000 }: { lean?: string | null; timeoutMs?: number } = {}) {
    if (!lean) {
      throw new LeanMissing(
        "Lean is not installed. Install elan (https://github.com/leanprover/elan) and run `elan default stable`, or set NEARWATCH_LEAN.",
      );
    }
    this.lean = lean;
    this.timeoutMs = timeoutMs;
  }

  async checkLean(formalization: string, property: Property, proofBody: string): Promise<LeanOutcome> {
    const name = theoremName(property.rule);
    const marker = `nearwatch-end-${randomUUID()}`;
    const dir = await mkdtemp(join(tmpdir(), "nearwatch-lean-"));
    const file = `${name}.lean`;
    try {
      await writeFile(join(dir, file), assembleLeanFile(formalization, property, proofBody, marker));
      const { code, output } = await run(this.lean, [file], dir, this.timeoutMs);
      const axioms = readAxiomReport(output, name, marker);
      // Lean's own text, unchanged apart from dropping the trailer's marker line.
      const text = output
        .split("\n")
        .filter((l) => l !== marker)
        .join("\n")
        .trimEnd();
      if (code === 0 && axioms !== null) return { ok: true, errors: "", axioms };
      if (code === 0) {
        return { ok: false, errors: `${text}\nLean gave no axiom report for ${name}; the proof body may have ended the file early.`.trim(), axioms: [] };
      }
      return { ok: false, errors: text, axioms: axioms ?? [] };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

function run(cmd: string, args: string[], cwd: string, timeout: number): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, timeout, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      const output = `${stdout}${stderr}`;
      if (err && typeof err.code !== "number") {
        reject(new Error(`Could not run Lean (${cmd}): ${err.message}`));
        return;
      }
      resolve({ code: err ? (err.code as number) : 0, output });
    });
  });
}
