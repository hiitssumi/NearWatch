// Ticket 04: live Audit plumbing, tested with fakes and Recordings. No test calls a live LLM.
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { auditOptionsFrom, runAudit } from "../src/audit.ts";
import { readContract, UnsupportedContract } from "../src/contract.ts";
import type { AgentName } from "../src/domain.ts";
import { liveAudit } from "../src/live-audit.ts";
import { type FetchFn, LiveGateway, LlmCallError } from "../src/llm/live.ts";
import type { LlmAnswer, LlmGateway } from "../src/ports.ts";
import { FakePayer, loadRecording, type Recording, ReplayToolchain, replayPorts } from "../src/replay/recording.ts";
import { parseSettings, type Settings, SettingsError } from "../src/settings.ts";
import { formalAnswer, lean, PROOF_R1, PROOF_R2, proofAnswer, refinementAnswer, storedLean } from "./hand-made.ts";
import { FORMALIZATION, REFINED } from "./lean/cases.ts";

const fixture = (p: string) => new URL(`fixtures/${p}`, import.meta.url).pathname;
const HAND_MADE = new URL("../recordings/hand-made.json", import.meta.url).pathname;
const SECRET = "sk-test-do-not-print-0123456789";

const rawSettings = () => ({
  nearAiKey: SECRET,
  models: { scout: "glm", rules: "glm", attacker: "ds", prover: "opus", referee: "glm", reporter: "glm" },
  prices: {
    glm: { inputPerMillion: 1.8, outputPerMillion: 5.75 },
    ds: { inputPerMillion: 0.3, outputPerMillion: 1.2 },
    opus: { inputPerMillion: 4, outputPerMillion: 20 },
  },
});
const settings = (over: Partial<Settings> = {}): Settings => ({ ...parseSettings(rawSettings()), ...over });

/**
 * A scripted gateway that counts its calls. Each agent gets its own answers in order, as in replay, since
 * the Attacker and the Prover's side ask side by side.
 */
class Scripted implements LlmGateway {
  calls: AgentName[] = [];
  private readonly answers: (LlmAnswer & { agent: AgentName })[];
  constructor(answers: (LlmAnswer & { agent: AgentName })[]) {
    this.answers = [...answers];
  }
  async ask(agent: AgentName): Promise<LlmAnswer> {
    this.calls.push(agent);
    const i = this.answers.findIndex((a) => a.agent === agent);
    if (i < 0) throw new Error(`no scripted answer for ${agent}`);
    const [{ agent: _, ...a }] = this.answers.splice(i, 1);
    return a;
  }
}

const tempDir = () => mkdtemp(join(tmpdir(), "nearwatch-test-"));

// ---- Contracts ----

test("a near-sdk .rs file and a near-sdk crate folder are accepted", async () => {
  assert.match(await readContract(fixture("vault.rs")), /near_sdk/);
  const crate = await readContract(fixture("crate"));
  assert.match(crate, /\/\/ ---- src\/lib\.rs ----/);
  assert.match(await readContract(fixture("workspace-crate")), /near_sdk/, "near-sdk.workspace = true counts");
});

for (const [name, path, why] of [
  ["a Solidity file", "vault.sol", /not a Rust source file/],
  ["Rust without near-sdk", "plain.rs", /does not use near_sdk/],
  ["a crate without near-sdk", "not-near", /does not depend on near-sdk/],
  ["a missing path", "nope.rs", /no such file/],
] as const) {
  test(`${name} is refused with a clear message before any LLM call`, async () => {
    const llm = new Scripted([]);
    let settingsRead = false;
    await assert.rejects(
      liveAudit({
        contractPath: fixture(path),
        outDir: await tempDir(),
        settings: "does-not-exist.json",
        llm: () => {
          settingsRead = true;
          return llm;
        },
      }),
      (e: Error) => e instanceof UnsupportedContract && /only Rust contracts written with near-sdk/.test(e.message) && why.test(e.message),
    );
    assert.equal(llm.calls.length, 0);
    assert.equal(settingsRead, false);
  });
}

// ---- Settings ----

test("settings default the spend cap to $5 and the base URL to NEAR AI Cloud", () => {
  const s = parseSettings(rawSettings());
  assert.equal(s.spendCapUsd, 5);
  assert.equal(s.baseUrl, "https://cloud-api.near.ai/v1");
});

test("settings errors name the field and never print the key", () => {
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ nearAiKey: "" }, /"nearAiKey" is missing/],
    [{ models: { ...rawSettings().models, prover: undefined } }, /"models.prover" is missing/],
    [{ prices: { glm: rawSettings().prices.glm, ds: rawSettings().prices.ds } }, /no price for model "opus" \(used by prover\)/],
    [{ spendCapUsd: -1 }, /"spendCapUsd"/],
  ];
  for (const [over, msg] of cases) {
    assert.throws(
      () => parseSettings({ ...rawSettings(), ...over }),
      (e: Error) => e instanceof SettingsError && msg.test(e.message) && !e.message.includes(SECRET),
    );
  }
});

test("the example settings file has names only: no key and no account", async () => {
  const example = JSON.parse(await readFile(new URL("../settings.example.json", import.meta.url), "utf8"));
  assert.equal(example.nearAiKey, "");
  assert.equal(example.parentKey, "");
  assert.throws(() => parseSettings(example), /"nearAiKey" is missing/);
  assert.doesNotThrow(() => parseSettings({ ...example, nearAiKey: "x" }));
});

// ---- Live gateway, against a fake fetch ----

const reply = (content: string, usage = { prompt_tokens: 1000, completion_tokens: 200 }, status = 200) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }], usage }), { status });

test("the live gateway calls the OpenAI-compatible endpoint with the agent's model and prices the call", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const fakeFetch: FetchFn = async (url, init) => {
    seen.push({ url, init });
    return reply('{"ok":true}');
  };
  const gw = new LiveGateway(settings(), { fetch: fakeFetch });
  const r = await gw.ask("attacker", "hello");
  assert.equal(seen[0]!.url, "https://cloud-api.near.ai/v1/chat/completions");
  assert.equal((seen[0]!.init.headers as Record<string, string>).authorization, `Bearer ${SECRET}`);
  const body = JSON.parse(seen[0]!.init.body as string);
  assert.equal(body.model, "ds");
  assert.equal(body.messages.at(-1).content, "hello");
  assert.deepEqual(r.tokens, { input: 1000, output: 200 });
  assert.equal(r.model, "ds");
  assert.ok(Math.abs(r.usd! - (1000 * 0.3 + 200 * 1.2) / 1e6) < 1e-12);
});

test("the live gateway asks for a stream and joins the streamed answer and its usage", async () => {
  const events = [
    { choices: [{ delta: { reasoning_content: "thinking..." } }] },
    { choices: [{ delta: { content: '{"ok":' } }] },
    { choices: [{ delta: { content: "true}" } }] },
    { choices: [], usage: { prompt_tokens: 70, completion_tokens: 9 } },
  ];
  const sse = `${events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("")}data: [DONE]\n\n`;
  let body: Record<string, unknown> = {};
  const fakeFetch: FetchFn = async (_url, init) => {
    body = JSON.parse(init.body as string);
    // Split mid-event, as a network would.
    const bytes = new TextEncoder().encode(sse);
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(bytes.slice(0, 37));
        c.enqueue(bytes.slice(37));
        c.close();
      },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream" } });
  };
  const r = await new LiveGateway(settings(), { fetch: fakeFetch }).ask("scout", "hi");
  assert.equal(body.stream, true);
  assert.equal(r.answer, '{"ok":true}');
  assert.deepEqual(r.tokens, { input: 70, output: 9 });
});

test("request extras from settings are sent only to their own model, and cannot replace the model or messages", async () => {
  const bodies: Record<string, unknown>[] = [];
  const fakeFetch: FetchFn = async (_url, init) => {
    bodies.push(JSON.parse(init.body as string));
    return reply('{"ok":true}');
  };
  const extras = { ds: { chat_template_kwargs: { thinking: false } } };
  const gw = new LiveGateway(settings({ requestExtras: extras }), { fetch: fakeFetch });
  await gw.ask("attacker", "hello");
  await gw.ask("scout", "hello");
  assert.deepEqual(bodies[0]!.chat_template_kwargs, { thinking: false });
  assert.equal(bodies[1]!.chat_template_kwargs, undefined);
  assert.throws(() => parseSettings({ ...rawSettings(), requestExtras: { ds: { model: "other" } } }), /may not set "model"/);
  assert.deepEqual(parseSettings(rawSettings()).requestExtras, {});
});

test("the live gateway retries a rate limit and reports other HTTP errors clearly", async () => {
  let n = 0;
  const flaky: FetchFn = async () => (n++ === 0 ? new Response("slow down", { status: 429 }) : reply("{}"));
  const gw = new LiveGateway(settings(), { fetch: flaky, sleep: async () => {} });
  assert.equal((await gw.ask("scout", "x")).answer, "{}");
  assert.equal(n, 2);

  const denied = new LiveGateway(settings(), { fetch: async () => new Response("bad key", { status: 401 }), sleep: async () => {} });
  await assert.rejects(denied.ask("scout", "x"), (e: Error) => e instanceof LlmCallError && /HTTP 401: bad key/.test(e.message));
});

// ---- A live run with a fake model, recorded, then replayed ----

async function handMade() {
  const r = await loadRecording(HAND_MADE);
  const [scout, rules, attackR1, attackR2] = r.exchanges.map((e) => e.answer);
  const [attackerRun, refereeRun] = r.toolchain;
  // In the order the side-by-side part happens to finish: replay reads Scenario runs and Lean checks each in its own order.
  const toolchain = new ReplayToolchain([
    lean("R1", "statement"),
    attackerRun!,
    lean("R2", "statement"),
    lean("R1", "ok"),
    lean("R2", "ok"),
    refereeRun!,
    lean("R1", "ok"),
    lean("R2", "ok"),
    storedLean("refined-statement"),
    storedLean("after-refinement"),
  ]);
  return { scout: scout!, rules: rules!, attackR1: attackR1!, attackR2: attackR2!, toolchain };
}

test("a live run of the buggy vault: the Attacker and the Prover side by side, a Conflict on R1, one Refinement, the old proof failing against it; the Recording replays to the same result", async () => {
  const { scout, rules, attackR1, attackR2, toolchain } = await handMade();
  const glm = { model: "glm" };
  const fake = new Scripted([
    { agent: "scout", answer: "not json", tokens: { input: 900, output: 10 }, usd: 0.002, ...glm },
    { agent: "scout", answer: scout, tokens: { input: 1000, output: 150 }, usd: 0.003, ...glm },
    { agent: "rules", answer: rules, tokens: { input: 1500, output: 400 }, usd: 0.005, ...glm },
    { agent: "rules", answer: formalAnswer(), tokens: { input: 2000, output: 600 }, usd: 0.007, ...glm },
    { agent: "attacker", answer: attackR1, tokens: { input: 2600, output: 380 }, usd: 0.0012, model: "ds" },
    { agent: "attacker", answer: attackR2, tokens: { input: 2500, output: 260 }, usd: 0.0011, model: "ds" },
    { agent: "prover", answer: proofAnswer(PROOF_R1), tokens: { input: 3000, output: 500 }, usd: 0.022, model: "opus" },
    { agent: "prover", answer: proofAnswer(PROOF_R2), tokens: { input: 3000, output: 300 }, usd: 0.018, model: "opus" },
    { agent: "referee", answer: JSON.stringify({ explanation: EXPLANATION }), tokens: { input: 800, output: 90 }, usd: 0.002, ...glm },
    { agent: "rules", answer: refinementAnswer(), tokens: { input: 4000, output: 900 }, usd: 0.012, ...glm },
  ]);
  const outDir = await tempDir();
  const { result, recordingPath, notes } = await liveAudit({
    contractPath: fixture("vault.rs"),
    outDir,
    settings: settings(),
    llm: () => fake,
    toolchain,
  });

  const count = (agent: AgentName) => fake.calls.filter((a) => a === agent).length;
  assert.deepEqual(
    ["scout", "rules", "attacker", "prover", "referee"].map((a) => count(a as AgentName)),
    [2, 3, 2, 2, 1],
  );
  assert.deepEqual(fake.calls.slice(0, 3), ["scout", "scout", "rules"], "the Scout, then the Rules agent, before anything runs side by side");
  assert.deepEqual(fake.calls.slice(-2), ["referee", "rules"], "after the Referee: the explanation, then the Refinement");

  assert.deepEqual(result!.verdicts, { R1: "Broken", R2: "Proven" });
  assert.deepEqual(result!.scoutMap?.moneyMethods, ["deposit", "withdraw"]);
  assert.match(result!.scoutMap!.standingNote, /deployed account/);
  assert.deepEqual(result!.rules.map((r) => r.id), ["R1", "R2"]);
  assert.ok(result!.transcript.includes("  Total spend: $0.0733 (cap $5.00)"));

  // One Conflict, one Refinement, the old proof failing against it.
  assert.equal(result!.conflicts.length, 1);
  const [c] = result!.conflicts;
  assert.equal(c!.rule, "R1");
  assert.equal(c!.finding, "S1");
  assert.equal(c!.outcome, "resolved");
  assert.equal(c!.explanation, EXPLANATION);
  assert.equal(c!.refinements.length, 1);
  assert.equal(c!.refinements[0]!.method, "withdraw");
  assert.equal(c!.refinements[0]!.recheck.accepted, false);
  const t = result!.transcript;
  const at = (line: string) => t.findIndex((l) => l.includes(line));
  for (const line of [
    "== CONFLICT on R1 ==",
    "Finding S1, on the real contract in the sandbox:",
    "Proof, against the first Formalization (every call one step):",
    `Why they disagree (worded by an LLM; it decides nothing): ${EXPLANATION}`,
    "Payout: the Prover's claim on R1's share is cancelled and passes to the Attacker.",
    "== Rules agent: Refinement 1 of withdraw, for R1 ==",
    "== Referee: re-check of the old proof against Refinement 1 ==",
    "R1: the old proof NO LONGER PASSES",
    "The Conflict is resolved",
    "R1 ends Broken: a Finding outranks a proof.",
    "== Verdicts ==",
  ]) {
    assert.ok(at(line) >= 0, `the transcript shows: ${line}`);
  }
  assert.ok(at("Finding S1, on the real") < at("Proof, against the first") && at("Proof, against the first") < at("Why they disagree"));
  assert.ok(at("== Attacker ==") < at("== Prover ==") && at("== Prover ==") < at("== Referee =="), "each side's block printed in a fixed order");
  assert.ok(t.some((l) => l.includes("The Attacker and the Prover run side by side")));

  const recording = await loadRecording(recordingPath);
  assert.equal(recording.exchanges.length, 10);
  assert.ok(recording.exchanges.every((e) => typeof e.ms === "number"), "each exchange's time is recorded");
  assert.equal(recording.exchanges[0]!.model, "glm");
  assert.match(recording.exchanges[1]!.prompt!, /previous answer was invalid/);
  const refinePrompt = recording.exchanges.at(-1)!.prompt!;
  assert.match(refinePrompt, /There is a Conflict on R1/);
  assert.match(refinePrompt, /ONLY the call "withdraw"/);
  assert.match(refinePrompt, /start step and a resolve step/);
  assert.ok(refinePrompt.includes(PROOF_R1.trimEnd()), "the Rules agent sees the proof the Finding contradicts");
  const kinds = (op: "runScenario" | "checkLean") =>
    recording.toolchain.filter((t) => t.op === op).map((t) => (t.op === "runScenario" ? t.scenario : t.property));
  assert.deepEqual(kinds("runScenario"), ["S1", "S1"], "the Attacker's run, then the Referee's");
  assert.deepEqual(kinds("checkLean"), ["R1", "R2", "R1", "R2", "R1", "R2", "R1", "R1"], "statements, the Prover's, the Referee's, then the Refinement's statement and the re-check");
  assert.ok(recording.toolchain.every((t) => t.op !== "checkLean" || typeof t.outcome.ms === "number"), "each Lean check's time is recorded");
  assert.equal(recording.settings.stopAfter, undefined);
  assert.equal(recording.settings.prover, true);
  assert.equal(recording.settings.conflicts, true);

  // Each Formalization and each re-check outcome is written to the Audit's folder.
  assert.equal(await readFile(join(outDir, "formalization.lean"), "utf8"), `${FORMALIZATION.trimEnd()}\n`);
  assert.match(await readFile(join(outDir, "proofs", "property_R2.lean"), "utf8"), /^-- ACCEPTED by the Referee[^\n]*\n[\s\S]*theorem property_R2 :/);
  assert.equal(await readFile(join(outDir, "refinements", "R1-refinement-1.lean"), "utf8"), `${REFINED.trimEnd()}\n`);
  const recheck = await readFile(join(outDir, "refinements", "R1-refinement-1-recheck.lean"), "utf8");
  assert.match(recheck, /^-- Re-check of the old proof of R1 against Refinement 1: NO LONGER PASSES/);
  assert.match(recheck, /Invalid alternative name `withdraw`/);
  assert.match(recheck, /theorem property_R1 :/);
  assert.equal(JSON.parse(await readFile(join(outDir, "conflicts.json"), "utf8"))[0].outcome, "resolved");

  const file = JSON.parse(await readFile(join(outDir, "scenarios", "S1.json"), "utf8"));
  assert.equal(file.contractPath, fixture("vault.rs"));
  assert.equal(file.rule.id, "R1");
  assert.equal(file.scenario.id, "S1");
  assert.match(notes[0]!, /npm run scenario -- <file>/);
  assert.match(await readFile(join(outDir, "transcript.txt"), "utf8"), /Scenarios written to/);

  // progress.txt holds every transcript line as it happened; the side-by-side ones are tagged with their side.
  const progress = (await readFile(join(outDir, "progress.txt"), "utf8")).trimEnd().split("\n");
  assert.equal(progress.length, result!.transcript.length);
  const untagged = progress.map((l) => l.replace(/^\[(attacker|rules|prover)\] /, ""));
  assert.deepEqual([...untagged].sort(), [...result!.transcript].sort(), "the same lines, in the order they happened");
  for (const tag of ["attacker", "rules", "prover"]) assert.ok(progress.some((l) => l.startsWith(`[${tag}] `)), `lines tagged [${tag}]`);
  assert.equal(progress.at(-1), result!.transcript.at(-1));
  assert.ok(!JSON.stringify(recording).includes(SECRET), "the Recording must not hold the key");

  const replayed = await runAudit(recording.contract.path, replayPorts(recording), auditOptionsFrom(recording.settings));
  assert.deepEqual(replayed.transcript, result!.transcript);
  assert.deepEqual(replayed.rules, result!.rules);
  assert.deepEqual(replayed.conflicts, result!.conflicts);
});

const EXPLANATION =
  "The Scenario lowered alice's recorded balance by 1 NEAR while the transfer to the missing account failed, so nobody received it. The model treats withdraw as one step in which the transfer always lands.";

// ---- Spend cap and retries, from Recordings ----

const priced = (r: Recording, ...usd: number[]) => r.exchanges.forEach((e, i) => (e.usd = usd[i] ?? 0));

test("a Recording that reaches the spend cap stops asking agents and ends with verdicts", async () => {
  const r = await loadRecording(HAND_MADE);
  priced(r, 1, 4.5, 0.1, 0.1); // scout $1, rules $4.50: the cap of $5 is reached before the Attacker.
  r.toolchain = [];
  const result = await runAudit(r.contract.path, replayPorts(r, new FakePayer()), { spendCapUsd: 5 });
  assert.equal(result.rules.length, 2);
  assert.deepEqual(result.verdicts, { R1: "Unproven", R2: "Unproven" });
  assert.ok(result.transcript.some((l) => l.includes("Spend cap reached: $5.5000 of $5.00")));
  assert.ok(result.transcript.includes("  (spend cap: attacker not asked)"));
  assert.ok(result.transcript.some((l) => l.includes("Total spend: $5.5000 (cap $5.00) -- CAP REACHED")));
});

test("the spend cap also stops retries of an invalid answer", async () => {
  const r = await loadRecording(HAND_MADE);
  const bad = { agent: "scout" as const, answer: "{}", tokens: { input: 1, output: 1 }, usd: 0.3 };
  r.exchanges = [bad, bad, bad];
  const result = await runAudit(r.contract.path, replayPorts(r), { spendCapUsd: 0.5 });
  assert.equal(result.scoutMap, null);
  assert.deepEqual(result.verdicts, {});
  assert.ok(result.transcript.includes("  (spend cap: scout not asked)"));
});

test("an invalid Scout or Rules answer is retried up to twice, then that agent produces nothing", async () => {
  const r = await loadRecording(HAND_MADE);
  const [scout, rules] = r.exchanges;
  const badRules = { agent: "rules" as const, answer: '{"rules":[{"id":"R1"}]}', tokens: { input: 1, output: 1 } };

  r.exchanges = [scout!, badRules, badRules, rules!];
  const retried = await runAudit(r.contract.path, replayPorts(r), { stopAfter: "rules" });
  assert.equal(retried.rules.length, 2);
  assert.equal(retried.transcript.filter((l) => l.includes("invalid answer from rules")).length, 2);

  r.exchanges = [scout!, badRules, badRules, badRules];
  const gaveUp = await runAudit(r.contract.path, replayPorts(r), { stopAfter: "rules" });
  assert.deepEqual(gaveUp.rules, []);
  assert.ok(gaveUp.transcript.some((l) => l.includes("rules gave no valid answer after 2 retries")));
});
