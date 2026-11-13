// Ticket 11: the demo Recording, which the replay command plays by default.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { auditOptionsFrom, runAudit } from "../src/audit.ts";
import { loadRecording, replayPorts } from "../src/replay/recording.ts";

const DEMO = new URL("../recordings/demo-buggy-vault.json", import.meta.url).pathname;

test("the demo Recording is one full live Audit, made with the brief's models, with no key in it", async () => {
  const r = await loadRecording(DEMO);
  assert.match(r.commit, /^[0-9a-f]{40}$/, "made from a clean commit");
  assert.equal(r.settings.continuedFrom, undefined, "nothing replayed: every answer and outcome is from this run");
  assert.deepEqual(r.settings.models, {
    scout: "z-ai/glm-5.3",
    rules: "z-ai/glm-5.3",
    attacker: "deepseek-ai/DeepSeek-V4.1-Flash-1017-abliterated",
    prover: "anthropic/claude-opus-5-5",
    referee: "z-ai/glm-5.3",
    reporter: "z-ai/glm-5.3",
  });
  assert.ok(r.exchanges.every((e) => e.prompt && e.model && typeof e.usd === "number" && typeof e.ms === "number"));
  assert.equal(r.payouts.length, 9);
  assert.ok(r.fee && r.payouts.every((p) => "hash" in p));
  const text = JSON.stringify(r);
  assert.ok(!/ed25519:[1-9A-HJ-NP-Za-km-z]{80,}/.test(text), "no secret NEAR key");
  assert.ok(!/"(nearAiKey|parentKey)"/.test(text), "no key fields at all");
});

test("the demo Recording replays: the withdraw Rule Broken and the owner Rule Proven, one Conflict, one Refinement, and the withdraw share paid to the Attacker", async () => {
  const r = await loadRecording(DEMO);
  const result = await runAudit(r.contract.path, replayPorts(r), auditOptionsFrom(r.settings));
  // The Rules agent numbered the spec's Rule 1 (withdraw) R2 and Rule 2 (the owner's pause) R3.
  assert.match(result.rules.find((x) => x.id === "R2")!.text, /^A withdraw must take from the caller's recorded ledger/);
  assert.match(result.rules.find((x) => x.id === "R3")!.text, /^Only the stored owner may pause/);
  assert.deepEqual(result.verdicts, { R1: "Proven", R2: "Broken", R3: "Proven", R4: "Proven", R5: "Proven" });
  assert.equal(result.findings.length, 1);
  assert.equal(result.conflicts.length, 1);
  const [c] = result.conflicts;
  assert.equal(c!.rule, "R2");
  assert.equal(c!.outcome, "resolved");
  assert.equal(c!.refinements.length, 1);
  assert.equal(c!.afterRefinement?.counterexample?.check.accepted, true);
  assert.equal(c!.afterRefinement?.counterexample?.samePath, true);
  const r2 = result.payouts.find((p) => p.reason === "R2 Broken")!;
  assert.equal(r2.to, "attacker");
  assert.equal(r2.hash, "GvHZ9QoWvWjkJPctWg18HSiiyY8s2GeVmEhrzwmCXvkk");
  assert.equal(result.payouts.reduce((s, p) => s + BigInt(p.yoctoNear), 0n), 10n ** 24n);
  assert.notEqual(result.report, null);
});

test("the replay command plays the demo Recording when given no other, and prints the whole Audit", () => {
  const out = execFileSync(process.execPath, [new URL("../src/cli/replay.ts", import.meta.url).pathname], { encoding: "utf8" });
  for (const part of [
    "recordings/demo-buggy-vault.json",
    "This Audit paid on NEAR testnet. Replay prints the recorded transaction hashes and sends nothing.",
    "Fee: 1 NEAR, moved from the payer's account to the parent account [AqyvXuxFdSdG1jUSaffqPwiCBAXvTcAMCSYhiRQ91mFZ]",
    "== Scout ==\n  Money moves through:",
    "== Rules agent ==",
    "S4: Rule check TRUE on the Referee's own run -> Finding against R2",
    "proof of R2: ACCEPTED",
    "== CONFLICT on R2 ==",
    "== Rules agent: Refinement 1 of withdraw, for R2 ==",
    "R2: the old proof NO LONGER PASSES",
    "R2: the counterexample HOLDS",
    "== Verdicts ==\n  R1: Proven\n  R2: Broken",
    "  attacker: 0.12 NEAR (R2 Broken) [GvHZ9QoWvWjkJPctWg18HSiiyY8s2GeVmEhrzwmCXvkk]",
    "  Total spend: $0.9655 (cap $5.00)",
  ]) {
    assert.ok(out.includes(part), `the replay prints: ${part}`);
  }
});
