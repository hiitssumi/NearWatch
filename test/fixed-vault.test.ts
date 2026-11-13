// Ticket 14: the live Audit of the fixed vault, replayed. A clean result to set beside the buggy vault's.
import assert from "node:assert/strict";
import { test } from "node:test";
import { auditOptionsFrom, runAudit } from "../src/audit.ts";
import { loadRecording, replayPorts } from "../src/replay/recording.ts";

const FIXED = new URL("../recordings/live-fixed-vault.json", import.meta.url).pathname;

test("the live Audit of the fixed vault replays: no Finding, no Conflict, every Rule Proven, the Attacker's attempts kept as Leads", async () => {
  const r = await loadRecording(FIXED);
  assert.equal(r.contract.path, "rust/vaults/fixed");
  assert.equal(r.settings.counterexamples, true, "made with everything a live Audit runs");
  const result = await runAudit(r.contract.path, replayPorts(r), auditOptionsFrom(r.settings));

  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.conflicts, []);
  assert.ok(!result.transcript.some((l) => l.includes("CONFLICT")));
  // The Rules agent numbered withdraw R2 and the owner's pause R4 (the spec's Rules 1 and 2).
  assert.match(result.rules.find((x) => x.id === "R2")!.text, /^A withdraw must keep/);
  assert.match(result.rules.find((x) => x.id === "R4")!.text, /^Only the owner may pause/);
  assert.deepEqual(result.verdicts, { R1: "Proven", R2: "Proven", R3: "Proven", R4: "Proven", R5: "Proven" });
  assert.ok(result.proofs.every((p) => p.accepted));

  // Every Scenario the Attacker ran broke nothing and is a Lead; so is every bug class it skipped, with its reason.
  const scenarios = result.leads.filter((l) => l.scenario);
  assert.equal(scenarios.length, 21);
  assert.ok(scenarios.every((l) => /did not make the Rule check true/.test(l.reason)));
  assert.equal(result.leads.length, 52);

  // No Rule is Unproven, so the payer gets back only the Reporter's share (the Reporter does not exist yet).
  assert.deepEqual(
    result.payouts.filter((p) => p.to === "payer").map((p) => p.reason),
    ["reporter did not run, its 5% share returned"],
  );
  assert.ok(result.payouts.every((p) => p.to !== "attacker"));
});
