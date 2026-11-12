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

/** A scripted gateway that counts its calls. */
class Scripted implements LlmGateway {
  calls: AgentName[] = [];
  private readonly answers: LlmAnswer[];
  constructor(answers: LlmAnswer[]) {
    this.answers = [...answers];
  }
  async ask(agent: AgentName): Promise<LlmAnswer> {
    this.calls.push(agent);
    const a = this.answers.shift();
    if (!a) throw new Error(`no scripted answer for ${agent}`);
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
  return { scout: scout!, rules: rules!, attackR1: attackR1!, attackR2: attackR2!, toolchain: new ReplayToolchain(r.toolchain) };
}

test("a live run records every exchange and sandbox run, writes its Scenarios, and its Recording replays to the same result", async () => {
  const { scout, rules, attackR1, attackR2, toolchain } = await handMade();
  const fake = new Scripted([
    { answer: "not json", tokens: { input: 900, output: 10 }, usd: 0.002, model: "glm" },
    { answer: scout, tokens: { input: 1000, output: 150 }, usd: 0.003, model: "glm" },
    { answer: rules, tokens: { input: 1500, output: 400 }, usd: 0.005, model: "glm" },
    { answer: attackR1, tokens: { input: 2600, output: 380 }, usd: 0.0012, model: "ds" },
    { answer: attackR2, tokens: { input: 2500, output: 260 }, usd: 0.0011, model: "ds" },
  ]);
  const outDir = await tempDir();
  const { result, recordingPath, notes } = await liveAudit({
    contractPath: fixture("vault.rs"),
    outDir,
    settings: settings(),
    llm: () => fake,
    toolchain,
  });

  assert.deepEqual(fake.calls, ["scout", "scout", "rules", "attacker", "attacker"]);
  assert.deepEqual(result!.verdicts, { R1: "Broken", R2: "Unproven" });
  assert.deepEqual(result!.scoutMap?.moneyMethods, ["deposit", "withdraw"]);
  assert.match(result!.scoutMap!.standingNote, /deployed account/);
  assert.deepEqual(result!.rules.map((r) => r.id), ["R1", "R2"]);
  assert.ok(result!.transcript.includes("  Total spend: $0.0123 (cap $5.00)"));

  const recording = await loadRecording(recordingPath);
  assert.equal(recording.exchanges.length, 5);
  assert.equal(recording.exchanges[0]!.model, "glm");
  assert.match(recording.exchanges[1]!.prompt!, /previous answer was invalid/);
  assert.deepEqual(recording.toolchain.map((t) => t.op === "runScenario" && t.scenario), ["S1", "S1"], "the Attacker's run, then the Referee's");
  assert.equal(recording.settings.stopAfter, undefined);

  const file = JSON.parse(await readFile(join(outDir, "scenarios", "S1.json"), "utf8"));
  assert.equal(file.contractPath, fixture("vault.rs"));
  assert.equal(file.rule.id, "R1");
  assert.equal(file.scenario.id, "S1");
  assert.match(notes[0]!, /npm run scenario -- <file>/);
  assert.match(await readFile(join(outDir, "transcript.txt"), "utf8"), /Scenarios written to/);
  assert.ok(!JSON.stringify(recording).includes(SECRET), "the Recording must not hold the key");

  const replayed = await runAudit(recording.contract.path, replayPorts(recording), auditOptionsFrom(recording.settings));
  assert.deepEqual(replayed.transcript, result!.transcript);
  assert.deepEqual(replayed.rules, result!.rules);
});

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
