// A live Audit: reads the contract (refusing anything that is not Rust near-sdk before any LLM call),
// runs the Audit runner through the recording gateway and a recording sandbox toolchain, and writes the
// Recording, the results and every Scenario (in a form that can be re-run) to a folder.

import { appendFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type AuditOptions, runAudit } from "./audit.ts";
import { readContract } from "./contract.ts";
import type { AuditResult, Rule, Scenario } from "./domain.ts";
import { assembleLeanFile, LocalLean, negatedProperty, theoremName } from "./lean.ts";
import { LiveGateway } from "./llm/live.ts";
import { currentCommit, RecordingGateway, RecordingPayer, RecordingToolchain } from "./llm/recording.ts";
import { testnetPayer } from "./near/payments.ts";
import type { LlmGateway, Payer, Toolchain } from "./ports.ts";
import { ReplayThenLive, ReplayThenLiveToolchain } from "./replay/continue.ts";
import { FakePayer, loadRecording } from "./replay/recording.ts";
import { LocalSandbox, VAULT_SETUP } from "./sandbox.ts";
import { loadSettings, publicSettings, type Settings } from "./settings.ts";

/** The local sandbox and the local Lean install. Throws before any LLM call if Lean is missing. */
export function localToolchain(): Toolchain {
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
  /** Replaces the payer chosen from settings (tests). */
  payer?: Payer;
  /** Called with each transcript line as it happens (the command prints them). */
  onLine?: (line: string) => void;
  /**
   * An earlier live Recording of the same contract to continue: its answers and outcomes are replayed, and only
   * what it does not hold goes to the live model and the local toolchain. The new Recording says so.
   */
  continueFrom?: string;
}

export async function liveAudit(req: LiveAuditRequest): Promise<{ result: AuditResult | null; recordingPath: string; notes: string[] }> {
  const source = await readContract(req.contractPath);
  const settings = typeof req.settings === "object" ? req.settings : await loadSettings(req.settings);
  const liveLlm = req.llm ? req.llm(settings) : new LiveGateway(settings);
  const liveToolchain = req.toolchain ?? localToolchain();
  let continued: { from: string; llm: ReplayThenLive; toolchain: ReplayThenLiveToolchain } | null = null;
  if (req.continueFrom) {
    const earlier = await loadRecording(req.continueFrom);
    if (earlier.contract.source !== source) throw new Error(`${req.continueFrom} is a Recording of a different contract source; it cannot be continued.`);
    continued = {
      from: req.continueFrom,
      llm: new ReplayThenLive(earlier.exchanges, liveLlm),
      toolchain: new ReplayThenLiveToolchain(earlier.toolchain, liveToolchain),
    };
  }
  const toolchain = new RecordingToolchain(continued?.toolchain ?? liveToolchain);
  const llm = new RecordingGateway(continued?.llm ?? liveLlm);
  const options: AuditOptions = { spendCapUsd: settings.spendCapUsd, prover: true, conflicts: true, counterexamples: true, reporter: true, folder: req.outDir };
  // Stored in the Recording, so anyone replaying it can see which part was live in this run.
  const continuation = () =>
    continued && {
      continuedFrom: {
        recording: continued.from,
        replayedExchanges: continued.llm.replayed,
        replayedPromptsChanged: continued.llm.promptsChanged,
        liveExchanges: continued.llm.live,
        replayedToolchain: continued.toolchain.replayed,
        liveToolchain: continued.toolchain.live,
      },
    };

  await mkdir(req.outDir, { recursive: true });
  const progressPath = join(req.outDir, "progress.txt");
  await writeFile(progressPath, "");
  const recordingPath = join(req.outDir, "recording.json");
  // Real testnet transfers when settings name a parent account and key; otherwise the fake payer.
  const payer = new RecordingPayer(req.payer ?? testnetPayer(settings) ?? new FakePayer());
  const paid = () => (payer.simulated ? {} : { payer: payer.describe, ...(payer.explorer ? { payerExplorer: payer.explorer } : {}) });
  const saveRecording = () =>
    writeFile(
      recordingPath,
      `${JSON.stringify(
        llm.toRecording({
          commit: currentCommit(),
          settings: { ...publicSettings(settings), ...options, ...continuation(), ...paid() },
          contract: { path: req.contractPath, source },
          toolchain: toolchain.entries,
          // The fake payer's Payouts are not stored: a replay works them out again and sends nothing.
          ...(payer.simulated ? {} : { payments: { fee: payer.fee, payouts: payer.payouts } }),
        }),
        null,
        2,
      )}\n`,
    );

  let result: AuditResult | null = null;
  try {
    result = await runAudit(
      req.contractPath,
      { llm, toolchain, payer, source: { read: async () => source } },
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
  await writeFile(join(req.outDir, "payouts.json"), `${JSON.stringify({ payer: payer.describe, fee: result.fee, payouts: result.payouts }, null, 2)}\n`);
  if (result.report !== null) await writeFile(join(req.outDir, "report.md"), result.report);
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
    // What the Prover found against the Refinement that resolved the Conflict, as the file the Referee checked.
    const after = c.afterRefinement;
    const r = c.refinements.at(-1);
    if (after && r && (after.counterexample || after.proof)) {
      const cx = after.counterexample;
      const check = cx ? cx.check : after.proof!;
      const name = `${c.rule}-refinement-${c.refinements.length}-${cx ? "counterexample" : "proof"}`;
      const errors = check.outcome?.errors ? `/- Lean's errors:\n${check.outcome.errors.replaceAll("-/", "- /")}\n-/\n` : "";
      const about = cx
        ? `-- Counterexample to the restated ${c.rule}: ${check.accepted ? "HOLDS" : "REJECTED"} (${check.reason})\n-- The Prover's path: ${cx.path}\n-- Same path as Finding ${c.finding}: ${cx.samePath === null ? "not compared" : cx.samePath ? "YES" : "NO"} (compared by an LLM; it decides nothing). ${cx.comparison}\n`
        : `-- Proof of the restated ${c.rule}: ${check.accepted ? "ACCEPTED" : "REJECTED"} (${check.reason})\n`;
      const property = cx ? negatedProperty(r.property) : r.property;
      await writeFile(join(req.outDir, "refinements", `${name}.lean`), about + errors + assembleLeanFile(r.formalization, property, check.body, "nearwatch-end"));
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
