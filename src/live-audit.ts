// A live Audit: reads the contract (refusing anything that is not Rust near-sdk before any LLM call),
// runs the Audit runner through the recording gateway and a recording sandbox toolchain, and writes the
// Recording, the results and every Scenario (in a form that can be re-run) to a folder.

import { appendFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type AuditOptions, runAudit } from "./audit.ts";
import { readContract } from "./contract.ts";
import type { AuditResult, Rule, Scenario } from "./domain.ts";
import { assembleLeanFile, LocalLean, theoremName } from "./lean.ts";
import { LiveGateway } from "./llm/live.ts";
import { currentCommit, RecordingGateway, RecordingToolchain } from "./llm/recording.ts";
import type { LlmGateway, Toolchain } from "./ports.ts";
import { FakePayer } from "./replay/recording.ts";
import { LocalSandbox, VAULT_SETUP } from "./sandbox.ts";
import { loadSettings, publicSettings, type Settings } from "./settings.ts";

/** The local sandbox and the local Lean install. Throws before any LLM call if Lean is missing. */
function localToolchain(): Toolchain {
  const sandbox = new LocalSandbox(VAULT_SETUP);
  const lean = new LocalLean();
  return {
    runScenario: (path, scenario, check) => sandbox.runScenario(path, scenario, check),
    checkLean: (formalization, property, body) => lean.checkLean(formalization, property, body),
  };
}

/** What a Scenario file holds: enough to re-run it with `npm run scenario -- <file>`. */
export interface ScenarioFile {
  contractPath: string;
  rule: Rule;
  scenario: Scenario;
}

export interface LiveAuditRequest {
  contractPath: string;
  outDir: string;
  /** Settings, or a path to read them from. */
  settings?: Settings | string;
  /** Replaces the live gateway (tests). */
  llm?: (settings: Settings) => LlmGateway;
  /** Replaces the local sandbox (tests). */
  toolchain?: Toolchain;
  /** Called with each transcript line as it happens (the command prints them). */
  onLine?: (line: string) => void;
}

export async function liveAudit(req: LiveAuditRequest): Promise<{ result: AuditResult | null; recordingPath: string; notes: string[] }> {
  const source = await readContract(req.contractPath);
  const settings = typeof req.settings === "object" ? req.settings : await loadSettings(req.settings);
  const toolchain = new RecordingToolchain(req.toolchain ?? localToolchain());
  const llm = new RecordingGateway(req.llm ? req.llm(settings) : new LiveGateway(settings));
  const options: AuditOptions = { spendCapUsd: settings.spendCapUsd, prover: true, conflicts: true };

  await mkdir(req.outDir, { recursive: true });
  const progressPath = join(req.outDir, "progress.txt");
  await writeFile(progressPath, "");
  const recordingPath = join(req.outDir, "recording.json");
  const saveRecording = () =>
    writeFile(
      recordingPath,
      `${JSON.stringify(
        llm.toRecording({
          commit: currentCommit(),
          settings: { ...publicSettings(settings), ...options },
          contract: { path: req.contractPath, source },
          toolchain: toolchain.entries,
        }),
        null,
        2,
      )}\n`,
    );

  let result: AuditResult | null = null;
  try {
    result = await runAudit(
      req.contractPath,
      { llm, toolchain, payer: new FakePayer(), source: { read: async () => source } },
      {
        ...options,
        // Each line is appended to progress.txt as it happens, so a long Audit can be watched.
        onLine: (line) => {
          appendFileSync(progressPath, `${line}\n`);
          req.onLine?.(line);
        },
      },
    );
  } finally {
    // Saved even when the Audit fails part-way, so the money spent is not lost.
    await saveRecording();
  }
  await writeFile(join(req.outDir, "scout-map.json"), `${JSON.stringify(result.scoutMap, null, 2)}\n`);
  await writeFile(join(req.outDir, "rules.json"), `${JSON.stringify(result.rules, null, 2)}\n`);
  if (result.formalization !== null) {
    await writeFile(join(req.outDir, "formalization.lean"), `${result.formalization.trimEnd()}\n`);
    await writeFile(join(req.outDir, "properties.json"), `${JSON.stringify(result.properties, null, 2)}\n`);
  }
  for (const proof of result.proofs) {
    const property = result.properties.find((p) => p.rule === proof.rule);
    if (!property || result.formalization === null) continue;
    await mkdir(join(req.outDir, "proofs"), { recursive: true });
    // The whole file Lean checked, as the toolchain assembled it, with the Referee's judgement on top.
    const header = `-- ${proof.accepted ? "ACCEPTED" : "REJECTED"} by the Referee: ${proof.reason}\n`;
    const file = assembleLeanFile(result.formalization, property, proof.body, "nearwatch-end");
    await writeFile(join(req.outDir, "proofs", `${theoremName(proof.rule)}.lean`), header + file);
  }
  if (result.conflicts.length > 0) {
    await writeFile(join(req.outDir, "conflicts.json"), `${JSON.stringify(result.conflicts, null, 2)}\n`);
    await mkdir(join(req.outDir, "refinements"), { recursive: true });
  }
  for (const c of result.conflicts) {
    for (const [i, r] of c.refinements.entries()) {
      const name = `${c.rule}-refinement-${i + 1}`;
      await writeFile(join(req.outDir, "refinements", `${name}.lean`), `${r.formalization.trimEnd()}\n`);
      // The file the Referee re-checked: the Refinement, the Property, and the old proof, with the outcome on top.
      const errors = r.recheck.outcome?.errors ? `/- Lean's errors:\n${r.recheck.outcome.errors.replaceAll("-/", "- /")}\n-/\n` : "";
      const header = `-- Re-check of the old proof of ${c.rule} against Refinement ${i + 1}: ${r.recheck.accepted ? "STILL PASSES" : "NO LONGER PASSES"} (${r.recheck.reason})\n${errors}`;
      await writeFile(
        join(req.outDir, "refinements", `${name}-recheck.lean`),
        header + assembleLeanFile(r.formalization, r.property, r.recheck.body, "nearwatch-end"),
      );
    }
  }
  const scenarios = [...result.findings.map((f) => f.scenario), ...result.leads.flatMap((l) => (l.scenario ? [l.scenario] : []))];
  const written = new Set<string>();
  for (const scenario of scenarios) {
    const rule = result.rules.find((r) => r.id === scenario.rule);
    if (!rule || written.has(scenario.id)) continue;
    written.add(scenario.id);
    const file: ScenarioFile = { contractPath: req.contractPath, rule, scenario };
    await mkdir(join(req.outDir, "scenarios"), { recursive: true });
    await writeFile(join(req.outDir, "scenarios", `${scenario.id}.json`), `${JSON.stringify(file, null, 2)}\n`);
  }
  // The note is kept out of result.transcript, so a replay's transcript matches the live one exactly.
  const note = written.size > 0 ? [`Scenarios written to ${join(req.outDir, "scenarios")}; re-run one with: npm run scenario -- <file>`] : [];
  await writeFile(join(req.outDir, "transcript.txt"), `${[...result.transcript, "", ...note].join("\n")}\n`);
  return { result, recordingPath, notes: note };
}
