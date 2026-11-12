// Seam 1, the Attacker: its rounds, budget and inputs, run from Recordings built on the hand-made one.
import assert from "node:assert/strict";
import { test } from "node:test";
import { rulesAgent } from "../src/agents/agents.ts";
import { BUG_CLASSES } from "../src/agents/attacker.ts";
import { runAudit } from "../src/audit.ts";
import type { ScenarioOutcome } from "../src/domain.ts";
import { RecordingGateway } from "../src/llm/recording.ts";
import { loadRecording, type Recording, replayPorts, type ToolchainEntry } from "../src/replay/recording.ts";
import { attackerRound, rulesAnswer } from "../src/schemas.ts";
import { InvalidAnswer } from "../src/validate.ts";
import { HAND_MADE, handMadeScenario, storedOutcome } from "./hand-made.ts";

const SOURCE = "// vault source\nimpl Vault { pub fn withdraw(&mut self) {} }\n";

/** The hand-made Scout and Rules, then the given Attacker answers and toolchain outcomes. */
async function recording(attacker: unknown[], toolchain: ToolchainEntry[]): Promise<Recording> {
  const r = await loadRecording(HAND_MADE);
  r.contract.source = SOURCE;
  const tokens = { input: 100, output: 10 };
  r.exchanges = [r.exchanges[0]!, r.exchanges[1]!, ...attacker.map((a) => ({ agent: "attacker" as const, answer: JSON.stringify(a), tokens }))];
  r.toolchain = toolchain;
  return r;
}

/** Runs the Audit and keeps the prompts the Attacker was given. */
async function audit(r: Recording) {
  const ports = replayPorts(r);
  const llm = new RecordingGateway(ports.llm);
  const result = await runAudit(r.contract.path, { ...ports, llm });
  const prompts = llm.exchanges.filter((e) => e.agent === "attacker").map((e) => e.prompt!);
  return { result, prompts };
}

async function attempt(bugClass: number) {
  const s = handMadeScenario(await loadRecording(HAND_MADE));
  return { bugClass, setup: s.setup, call: s.call };
}

/** A copy of the hand-made outcome with the Rule check and the recorded balance after set. */
async function outcome(ruleCheckTrue: boolean, recordedAfter = "0"): Promise<ScenarioOutcome> {
  const o = structuredClone(storedOutcome(await loadRecording(HAND_MADE), 0));
  o.ruleCheckTrue = ruleCheckTrue;
  o.observations.after.views.user_recorded = recordedAfter;
  return o;
}

const run = async (scenario: string, ruleCheckTrue: boolean, recordedAfter?: string): Promise<ToolchainEntry> => ({
  op: "runScenario",
  scenario,
  outcome: await outcome(ruleCheckTrue, recordedAfter),
});
const skipRest = (except: number[]) =>
  [1, 2, 3, 4, 5, 6, 7].filter((c) => !except.includes(c)).map((c) => ({ bugClass: c, reason: `class ${c} cannot apply` }));
const skipAll = { attempts: [], skip: skipRest([]) };

test("the Attacker is given the source, the Scout's map, the Rules, the sandbox actions and the bug classes, and nothing else", async () => {
  const r = await recording(
    [{ attempts: [await attempt(1)], skip: skipRest([1]) }, skipAll],
    [await run("S1", true), await run("S1", true)],
  );
  const { prompts } = await audit(r);
  assert.equal(prompts.length, 2);
  const p = prompts[0]!;
  assert.ok(p.includes(SOURCE), "the contract source");
  assert.ok(p.includes(JSON.parse(r.exchanges[0]!.answer).standingNote), "the Scout's map");
  for (const rule of JSON.parse(r.exchanges[1]!.answer).rules) assert.ok(p.includes(rule.text), `Rule ${rule.id}`);
  assert.ok(p.includes('{"action":"createAccount"') && p.includes('deployed to account "vault"'), "the sandbox actions and setup");
  BUG_CLASSES.forEach((c, i) => assert.ok(p.includes(`${i + 1}. ${c} [3]`), `bug class ${i + 1}`));
  // No path, crate name or folder name that could point at the bug.
  assert.ok(!p.includes(r.contract.path) && !/buggy|planted/i.test(p), "no contract path or crate name");
});

test("after a failed attempt the Attacker sees what the harness observed, and the Referee re-runs only the claimed Scenario", async () => {
  const r = await recording(
    [{ attempts: [await attempt(1)], skip: skipRest([1]) }, { attempts: [await attempt(1)] }, skipAll],
    [await run("S1", false, "4242"), await run("S2", true), await run("S2", true)],
  );
  const { result, prompts } = await audit(r);
  assert.match(prompts[1]!, /S1 \(bug class 1\): setup/);
  assert.match(prompts[1]!, /"user_recorded":"4242"/);
  assert.match(prompts[1]!, /Rule check: false/);
  assert.match(prompts[1]!, /1\. state not restored .* \[2\]/, "one attempt used, two left");

  assert.deepEqual(result.verdicts, { R1: "Broken", R2: "Unproven" });
  assert.deepEqual(result.findings.map((f) => f.scenario.id), ["S2"]);
  assert.deepEqual(result.leads.filter((l) => l.scenario).map((l) => l.scenario!.id), ["S1"]);
  assert.ok(result.transcript.includes("  S2: Rule check TRUE on the Referee's own run -> Finding against R1"));
  assert.ok(!result.transcript.some((l) => l.startsWith("  S1: ")), "the Referee does not run S1");
});

test("a Scenario that could not be run is shown to the Attacker with the harness's error", async () => {
  const error = 'scenario.setup[0].balance is "ten", not a decimal integer string';
  const r = await recording(
    [{ attempts: [await attempt(1)], skip: skipRest([1]) }, { attempts: [await attempt(1)] }, skipAll],
    [{ op: "runScenario", scenario: "S1", error }, await run("S2", true), await run("S2", true)],
  );
  const { result, prompts } = await audit(r);
  assert.ok(prompts[1]!.includes(`could not be run: ${error}`));
  assert.ok(result.leads.some((l) => l.scenario?.id === "S1" && l.reason.includes(error)));
  assert.deepEqual(result.verdicts, { R1: "Broken", R2: "Unproven" });
});

test("each bug class gets at most three attempts per Rule, then closes; every failed Scenario is a Lead", async () => {
  const r = await recording(
    [
      { attempts: [await attempt(1)], skip: skipRest([1]) },
      { attempts: [await attempt(1)] },
      { attempts: [await attempt(1)] },
      skipAll,
    ],
    [await run("S1", false), await run("S2", false), await run("S3", false)],
  );
  const { result, prompts } = await audit(r);
  assert.equal(prompts.filter((p) => p.includes("target is Rule R1")).length, 3, "no fourth round against R1");
  assert.match(prompts[2]!, /\[1\]/);
  assert.deepEqual(result.verdicts, { R1: "Unproven", R2: "Unproven" });
  assert.deepEqual(result.leads.filter((l) => l.scenario).map((l) => l.scenario!.id), ["S1", "S2", "S3"]);
  assert.equal(result.leads.filter((l) => l.rule === "R2" && l.reason.includes("skipped")).length, 7);
  assert.equal(result.findings.length, 0);
});

test("the Attacker stops at the first claimed Finding for a Rule", async () => {
  const r = await recording(
    [{ attempts: [await attempt(1), await attempt(4)], skip: skipRest([1, 4]) }, skipAll],
    [await run("S1", true), await run("S1", true)],
  );
  const { result, prompts } = await audit(r);
  assert.equal(prompts.filter((p) => p.includes("target is Rule R1")).length, 1);
  assert.ok(result.leads.some((l) => l.scenario?.id === "S2" && l.reason.includes("not run")));
  assert.deepEqual(result.findings.map((f) => f.scenario.id), ["S1"]);
});

test("an Attacker round naming a closed or repeated bug class is invalid, so the Attacker is asked again", () => {
  const setup = [{ action: "view", method: "owner", args: {} }];
  const call = { as: "alice", method: "withdraw", args: {}, deposit: "0", gas: "1" };
  assert.throws(() => attackerRound([1, 2])({ attempts: [{ bugClass: 3, setup, call }] }, ""), InvalidAnswer);
  assert.throws(
    () => attackerRound([1, 2])({ attempts: [{ bugClass: 1, setup, call }], skip: [{ bugClass: 1, reason: "x" }] }, ""),
    /appears more than once/,
  );
  assert.throws(() => attackerRound([1])({ attempts: [{ bugClass: 1, setup }] }, ""), /call: expected an object/);
  assert.deepEqual(attackerRound([1])({ attempts: [] }, "").skip, []);
});


// ---- Rule checks own their bindings ----

test("the Rules prompt's format example passes the validator, and the prompt says the Rules agent writes the bindings", async () => {
  let prompt = "";
  const llm = { ask: async (_a: string, p: string) => ((prompt = p), { answer: '{"rules":[]}', tokens: { input: 0, output: 0 } }) };
  await rulesAgent({ llm, tokens: {}, log: () => {} }, "src", { moneyMethods: [], balanceStorage: [], privilegedMethods: [], standingNote: "n" });
  const example = prompt.split("Example of the format only")[1]!.split("\n").slice(1).join("\n").split("\n\n")[0]!;
  assert.doesNotThrow(() => rulesAnswer(JSON.parse(example), ""));
  assert.match(prompt, /You write the bindings, not the attacker/);
});

test("a Rule check binding must be a known reference or a plain account name, of the slot's kind", () => {
  const ruleWith = (slot: object) => ({
    rules: [{ id: "R1", text: "t", check: { methods: ["withdraw"], slots: [slot], condition: { compare: "<", left: { slot: "s", when: "after" }, right: { number: "0" } } } }],
  });
  const ok = { name: "s", kind: "balance", describe: "d", bind: { account: "$arg:receiver_id" } };
  assert.doesNotThrow(() => rulesAnswer(ruleWith(ok), ""));
  assert.doesNotThrow(() => rulesAnswer(ruleWith({ ...ok, bind: { account: "user" } }), ""));
  assert.throws(() => rulesAnswer(ruleWith({ ...ok, bind: { account: "$receiver" } }), ""), /not a reference; use \$caller/);
  assert.throws(() => rulesAnswer(ruleWith({ ...ok, bind: { view: { method: "balance_of", args: {} } } }), ""), /a balance slot must bind \{"account"/);
  const view = { name: "s", kind: "view", describe: "d", bind: { view: { method: "balance_of", args: { account_id: "$who" } } } };
  assert.throws(() => rulesAnswer(ruleWith(view), ""), /args\.account_id: "\$who" is not a reference/);
  assert.throws(() => rulesAnswer({ rules: [{ ...ruleWith(ok).rules[0], check: { ...ruleWith(ok).rules[0]!.check, methods: [] } }] }, ""), /methods/);
});

test("a Rule check that compares a NEAR balance exactly is invalid, since wallets move by gas", () => {
  const slots = [
    { name: "credit", kind: "view", describe: "d", bind: { view: { method: "balance_of", args: { account_id: "$caller" } } } },
    { name: "receiver", kind: "balance", describe: "d", bind: { account: "$arg:receiver_id" } },
  ];
  const drop = { op: "sub", left: { slot: "credit", when: "before" }, right: { slot: "credit", when: "after" } };
  const gain = { op: "sub", left: { slot: "receiver", when: "after" }, right: { slot: "receiver", when: "before" } };
  const rules = (condition: object) => ({ rules: [{ id: "R2", text: "t", check: { methods: ["withdraw"], slots, condition } }] });
  // The live run's R2 (12 Nov): made true by a refused withdraw-to-self, where only gas moved.
  assert.throws(() => rulesAnswer(rules({ compare: "!=", left: drop, right: gain }), ""), /R2: compares a NEAR balance with "!="/);
  assert.throws(() => rulesAnswer(rules({ any: [{ compare: "==", left: gain, right: { number: "0" } }] }), ""), /with "=="/);
  assert.doesNotThrow(() => rulesAnswer(rules({ compare: ">", left: drop, right: { op: "add", left: gain, right: { number: "10000000000000000000000" } } }), ""));
  assert.doesNotThrow(() => rulesAnswer(rules({ compare: "!=", left: { slot: "credit", when: "after" }, right: { number: "0" } }), ""), "views may be compared exactly");
});

// ---- The live Audit of the buggy vault (12 Nov 2026, recordings/live-attacker-buggy-vault.json) ----

const LIVE = new URL("../recordings/live-attacker-buggy-vault.json", import.meta.url).pathname;

test("the live Recording of the buggy vault replays to the same verdicts: the planted bug, found unaided, and one real extra", async () => {
  const r = await loadRecording(LIVE);
  const { result, prompts } = await audit(r);
  assert.deepEqual(result.verdicts, { R1: "Unproven", R2: "Broken", R3: "Unproven", R4: "Broken", R5: "Unproven" });
  assert.deepEqual(result.findings.map((f) => f.scenario.id), ["S5", "S18"]);

  // S5 is the planted bug: a withdrawal to an account that does not exist lowers the record, and nothing arrives.
  const s5 = result.findings[0]!;
  assert.equal(s5.scenario.call.method, "withdraw");
  assert.equal(r.contract.path, "rust/vaults/buggy");
  const { before, after, failedReceipts } = s5.outcome.observations;
  assert.ok(BigInt(before.views.credit!) > BigInt(after.views.credit!), "the record went down");
  assert.equal(after.balances.recv, "0");
  assert.ok(failedReceipts.some((f) => f.includes("doesn't exist")));

  // S18 is real but not planted: a deposit attached to a view method stays in the vault, credited to nobody.
  assert.equal(result.findings[1]!.scenario.call.method, "balance_of");

  // The Attacker was told nothing about where the bug is.
  assert.ok(prompts.every((p) => !/buggy|planted/i.test(p) && !p.includes(r.contract.path)));
});
