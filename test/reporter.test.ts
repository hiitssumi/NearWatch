// Ticket 16: the Reporter, run from the fixed vault's live Recording with Reporter answers added after it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { auditOptionsFrom, runAudit } from "../src/audit.ts";
import { RecordingGateway } from "../src/llm/recording.ts";
import { loadRecording, type Recording, replayPorts } from "../src/replay/recording.ts";

const FIXED = new URL("../recordings/live-fixed-vault.json", import.meta.url).pathname;
const tokens = { input: 6000, output: 900 };

const words = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    summary: "Every Rule held. The Attacker found no way to break the vault, and each Rule was proven against its Lean description.",
    rules: ["R1", "R2", "R3", "R4", "R5"].map((rule) => ({ rule, text: `${rule} is Proven: the proof passed against the Lean description.` })),
    findings: [],
    conflicts: [],
    ...over,
  });

async function withReporter(answers: string[]): Promise<{ recording: Recording; options: ReturnType<typeof auditOptionsFrom> }> {
  const recording = await loadRecording(FIXED);
  recording.exchanges.push(...answers.map((answer) => ({ agent: "reporter" as const, answer, tokens, usd: 0.004 })));
  return { recording, options: { ...auditOptionsFrom(recording.settings), reporter: true, folder: "audits/t14-fixed-1" } };
}

test("the report gives each verdict, says what a proof covers, lists Leads apart from Findings, and gives every cost; a replay writes the same report", async () => {
  const { recording, options } = await withReporter([words()]);
  const llm = new RecordingGateway(replayPorts(recording).llm);
  const result = await runAudit(recording.contract.path, { ...replayPorts(recording), llm }, options);
  const report = result.report!;

  assert.ok(report.startsWith("# NearWatch Audit report: rust/vaults/fixed\n"));
  assert.match(report, /worded by the Reporter, an LLM, from the Referee's result\. The verdicts, calls, commands, Leads and costs are filled in by code/);
  for (const id of ["R1", "R2", "R3", "R4", "R5"]) assert.ok(report.includes(`| ${id} | Proven |`));
  assert.ok(report.includes("### R2: Proven\n\n> A withdraw must keep"), "each Rule's own text, then the Reporter's passage");
  assert.ok(report.includes("## Findings\n\nNone. No Scenario broke a Rule when the Referee re-ran it."));
  assert.ok(report.includes("## Conflicts\n\nNone."));
  assert.ok(report.includes("The proof covers that description, not the contract's code."));
  // All 52 Leads, after the Findings.
  const leads = report.slice(report.indexOf("## Leads"), report.indexOf("## Cost"));
  assert.equal(leads.split("\n").filter((l) => l.startsWith("- ")).length, 52);
  assert.match(leads, /- R2, S10 \(state not restored when a cross-contract call or transfer fails\): `[a-z]+` calls `withdraw`; Scenario S10 did not make the Rule check true\./);
  assert.ok(report.indexOf("## Findings") < report.indexOf("## Leads"));
  // The Audit's cost includes the report; each proof attempt has its own row.
  assert.ok(report.includes("The Audit's LLM calls cost $0.7411 in all (cap $5.00), including this report."));
  assert.ok(report.includes("| reporter | $0.0040 |"));
  assert.equal(result.proofAttempts.length, 5);
  for (const a of result.proofAttempts) assert.ok(report.includes(`| ${a.rule} | first Formalization | ${a.rounds} | $${a.usd.toFixed(4)} |`));
  assert.ok(result.transcript.includes(`  Report written (${report.split("\n").length} lines): audits/t14-fixed-1/report.md`));
  assert.ok(result.payouts.some((p) => p.to === "reporter" && p.reason === "5% flat share"));

  // The Reporter's prompt holds the Referee's result and forbids adding claims.
  const prompt = llm.exchanges.at(-1)!.prompt!;
  assert.match(prompt, /"verdict": "Proven"/);
  assert.match(prompt, /Do not suggest fixes, rate severity/);

  // Replaying the Recording, with the Reporter's exchange in it, writes the same report.
  const again = await runAudit(recording.contract.path, replayPorts(recording), options);
  assert.equal(again.report, report);
});

test("a Reporter answer that changes a verdict or leaves out a Rule is retried; still invalid after the retries, there is no report and its share returns to the payer", async () => {
  const wrongVerdict = words({ rules: ["R1", "R2", "R3", "R4", "R5"].map((rule) => ({ rule, text: rule === "R2" ? "R2 is Broken." : "Proven." })) });
  const missing = words({ rules: [{ rule: "R1", text: "Proven." }] });
  const { recording, options } = await withReporter([wrongVerdict, missing, "not json"]);
  const result = await runAudit(recording.contract.path, replayPorts(recording), options);

  assert.equal(result.report, null);
  const t = result.transcript;
  assert.ok(t.includes('  (invalid answer from reporter: rules: the passage for R2 says "broken", but R2 is Proven)'));
  assert.ok(t.includes("  (invalid answer from reporter: rules: expected exactly [R1, R2, R3, R4, R5], got [R1])"));
  assert.ok(t.includes("  No report: the Reporter gave no valid answer. Its share returns to the payer."));
  assert.ok(result.payouts.some((p) => p.to === "payer" && p.reason === "reporter did not run, its 5% share returned"));
  assert.deepEqual(result.verdicts, { R1: "Proven", R2: "Proven", R3: "Proven", R4: "Proven", R5: "Proven" }, "the Audit completes");
});

test("a Recording made before the Reporter existed replays with no report and asks the Reporter nothing", async () => {
  const recording = await loadRecording(FIXED);
  const result = await runAudit(recording.contract.path, replayPorts(recording), auditOptionsFrom(recording.settings));
  assert.equal(result.report, null);
  assert.ok(!result.transcript.includes("== Reporter =="));
});

// ---- The live run (ticket 16), continuing ticket 17's ----

test("the live Reporter Recording replays to the same report: the Broken withdraw Rule, its Finding and how to re-run it, the Conflict, Leads and costs", async () => {
  const r = await loadRecording(new URL("../recordings/live-report-buggy-vault.json", import.meta.url).pathname);
  // Everything before the Reporter is ticket 17's run, replayed; only the Reporter was asked live.
  assert.deepEqual(r.settings.continuedFrom, {
    recording: "recordings/live-counterexample-buggy-vault.json",
    replayedExchanges: 25,
    replayedPromptsChanged: 0,
    liveExchanges: 1,
    replayedToolchain: 48,
    liveToolchain: 0,
  });
  const result = await runAudit(r.contract.path, replayPorts(r), auditOptionsFrom(r.settings));
  const report = result.report!;
  for (const part of [
    "| R3 | Broken |",
    "### S8, against R3 (state not restored when a cross-contract call or transfer fails)",
    "- Re-run it in a fresh sandbox: `npm run scenario -- audits/t16-buggy-1/scenarios/S8.json`",
    "### R3: Finding S8 against an accepted proof",
    "- Counterexample: Lean confirms the restated Property is false for concrete values; it follows the same path as the Finding (compared by an LLM).",
    "The proof covers that description, not the contract's code.",
    "The Audit's LLM calls cost $1.7891 in all (cap $5.00), including this report.",
    "| R3 | Refinement | 1 | $0.0324 | 12.3 s | a counterexample submitted to the Referee |",
  ]) {
    assert.ok(report.includes(part), `the report has: ${part}`);
  }
  assert.equal(report.slice(report.indexOf("## Leads")).split("\n").filter((l) => l.startsWith("- ")).length, result.leads.length);
  const again = await runAudit(r.contract.path, replayPorts(r), auditOptionsFrom(r.settings));
  assert.equal(again.report, report);
});
