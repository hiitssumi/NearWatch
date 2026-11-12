// A live Audit: reads the contract (refusing anything that is not Rust near-sdk before any LLM call),
// runs the Audit runner through the recording gateway and a recording sandbox toolchain, and writes the
// Recording, the results and every Scenario (in a form that can be re-run) to a folder.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type AuditOptions, runAudit } from "./audit.ts";
import { readContract } from "./contract.ts";
import type { AuditResult, Rule, Scenario } from "./domain.ts";
import { LiveGateway } from "./llm/live.ts";
import { currentCommit, RecordingGateway, RecordingToolchain } from "./llm/recording.ts";
import type { LlmGateway, Toolchain } from "./ports.ts";
import { FakePayer } from "./replay/recording.ts";
import { LocalSandbox, VAULT_SETUP } from "./sandbox.ts";
import { loadSettings, publicSettings, type Settings } from "./settings.ts";

/** The local sandbox. Lean checking exists (src/lean.ts); the live Audit wires it in with the Prover (ticket 07). */
function sandboxToolchain(): Toolchain {
  const sandbox = new LocalSandbox(VAULT_SETUP);
  return {
    runScenario: (path, scenario, check) => sandbox.runScenario(path, scenario, check),
    checkLean: () => Promise.reject(new Error("No Prover in live Audits yet (ticket 07).")),
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
}

export async function liveAudit(req: LiveAuditRequest): Promise<{ result: AuditResult | null; recordingPath: string; notes: string[] }> {
  const source = await readContract(req.contractPath);
  const settings = typeof req.settings === "object" ? req.settings : await loadSettings(req.settings);
  const llm = new RecordingGateway(req.llm ? req.llm(settings) : new LiveGateway(settings));
  const toolchain = new RecordingToolchain(req.toolchain ?? sandboxToolchain());
  const options: AuditOptions = { spendCapUsd: settings.spendCapUsd };

  await mkdir(req.outDir, { recursive: true });
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
      options,
    );
  } finally {
    // Saved even when the Audit fails part-way, so the money spent is not lost.
    await saveRecording();
  }
  await writeFile(join(req.outDir, "scout-map.json"), `${JSON.stringify(result.scoutMap, null, 2)}\n`);
  await writeFile(join(req.outDir, "rules.json"), `${JSON.stringify(result.rules, null, 2)}\n`);
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
