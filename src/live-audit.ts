// A live Audit: reads the contract (refusing anything that is not Rust near-sdk before any LLM call),
// runs the Audit runner through the recording gateway, and writes the Recording and results to a folder.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type AuditOptions, runAudit } from "./audit.ts";
import { readContract } from "./contract.ts";
import type { AuditResult } from "./domain.ts";
import { LiveGateway } from "./llm/live.ts";
import { currentCommit, RecordingGateway } from "./llm/recording.ts";
import type { LlmGateway, Toolchain } from "./ports.ts";
import { FakePayer } from "./replay/recording.ts";
import { loadSettings, publicSettings, type Settings } from "./settings.ts";

/** Until the sandbox toolchain exists (tickets 02 and 05), the live Audit stops after the Rules agent. */
const NO_TOOLCHAIN: Toolchain = {
  runScenario: () => Promise.reject(new Error("No sandbox toolchain yet (tickets 02 and 05).")),
};

export interface LiveAuditRequest {
  contractPath: string;
  outDir: string;
  /** Settings, or a path to read them from. */
  settings?: Settings | string;
  /** Replaces the live gateway (tests). */
  llm?: (settings: Settings) => LlmGateway;
}

export async function liveAudit(req: LiveAuditRequest): Promise<{ result: AuditResult | null; recordingPath: string }> {
  const source = await readContract(req.contractPath);
  const settings = typeof req.settings === "object" ? req.settings : await loadSettings(req.settings);
  const llm = new RecordingGateway(req.llm ? req.llm(settings) : new LiveGateway(settings));
  const options: AuditOptions = { spendCapUsd: settings.spendCapUsd, stopAfter: "rules" };

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
        }),
        null,
        2,
      )}\n`,
    );

  let result: AuditResult | null = null;
  try {
    result = await runAudit(
      req.contractPath,
      { llm, toolchain: NO_TOOLCHAIN, payer: new FakePayer(), source: { read: async () => source } },
      options,
    );
  } finally {
    // Saved even when the Audit fails part-way, so the money spent is not lost.
    await saveRecording();
  }
  await writeFile(join(req.outDir, "scout-map.json"), `${JSON.stringify(result.scoutMap, null, 2)}\n`);
  await writeFile(join(req.outDir, "rules.json"), `${JSON.stringify(result.rules, null, 2)}\n`);
  await writeFile(join(req.outDir, "transcript.txt"), `${result.transcript.join("\n")}\n`);
  return { result, recordingPath };
}
