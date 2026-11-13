// Ticket 10: real Payouts, tested with stand-ins. No test here touches a network; the real payer against a real
// node is test/payments.slow.test.ts.
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { auditOptionsFrom, runAudit } from "../src/audit.ts";
import { liveAudit } from "../src/live-audit.ts";
import { base58Decode, base58Encode, KeyError, parseSecretKey } from "../src/near/keys.ts";
import { NearPayments, testnetPayer } from "../src/near/payments.ts";
import { type FetchLike, NearRpc } from "../src/near/rpc.ts";
import { encodeTransaction, signTransaction } from "../src/near/transaction.ts";
import { type Payer, PaymentError, type PayoutOrder } from "../src/ports.ts";
import { loadRecording, type Recording, ReplayError, ReplayGateway, ReplayToolchain, replayPorts } from "../src/replay/recording.ts";
import { parseSettings } from "../src/settings.ts";

// ---- Keys and transactions ----

/** A fresh secret key in NEAR's text form (seed and public key, 64 bytes). */
function freshKey(): { text: string; publicKey: Uint8Array } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32);
  const pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return { text: `ed25519:${base58Encode(Buffer.concat([seed, pub]))}`, publicKey: new Uint8Array(pub) };
}

test("a transfer is serialized exactly as NEAR's own JavaScript library serializes it", () => {
  // The "serialize transfer tx" vector from near-api-js's tests.
  const tx = encodeTransaction({
    signerId: "test.near",
    publicKey: base58Decode("Anu7LYDfpLtkP7E16LT9imXF694BdQaa9ufVkQiwTQxC"),
    nonce: 1n,
    receiverId: "whatever.near",
    blockHash: base58Decode("244ZQ9cgj3CQ6bWBdytfrJMuMQ1jdXLFGnr4HhvtCTnM"),
    actions: [{ type: "transfer", yoctoNear: 1n }],
  });
  assert.equal(
    Buffer.from(tx).toString("hex"),
    "09000000746573742e6e65617200917b3d268d4b58f7fec1b150bd68d69be3ee5d4cc39855e341538465bb77860d01000000000000000d00000077686174657665722e6e6561720fa473fd26901df296be6adc4cc4df34d040efa2435224b6986910e630c2fef6010000000301000000000000000000000000000000",
  );
  assert.equal(base58Encode(Uint8Array.of(0, 0, 1)), "112", "leading zero bytes keep their place");
  assert.deepEqual([...base58Decode("112")], [0, 0, 1]);
});

test("a secret key is read in both forms NEAR writes it, and no error ever shows it", () => {
  const { text, publicKey } = freshKey();
  const key = parseSecretKey(text, "the key");
  assert.deepEqual([...key.publicKey], [...publicKey]);
  assert.equal(key.publicKeyText, `ed25519:${base58Encode(publicKey)}`);
  const raw = base58Decode(text.slice(8));
  assert.deepEqual([...parseSecretKey(`ed25519:${base58Encode(raw.subarray(0, 32))}`, "the key").publicKey], [...publicKey], "the 32-byte seed alone");

  // A signature made with it covers the transaction's hash, after the transaction and the key type.
  const tx = { signerId: "a.testnet", publicKey: key.publicKey, nonce: 7n, receiverId: "b.testnet", blockHash: new Uint8Array(32), actions: [{ type: "transfer" as const, yoctoNear: 5n }] };
  const { hash, signed } = signTransaction(tx, key);
  const encoded = encodeTransaction(tx);
  assert.equal(signed.length, encoded.length + 1 + 64);
  assert.equal(base58Decode(hash).length, 32);

  const damaged = `ed25519:${base58Encode(Buffer.concat([raw.subarray(0, 32), new Uint8Array(32)]))}`;
  for (const [bad, why] of [
    [text.slice(8), /must look like "ed25519:<base58 text>"/],
    [`${text}0`, /not valid base58/],
    [`ed25519:${base58Encode(raw.subarray(0, 20))}`, /must hold 32 or 64 bytes, not 20/],
    [damaged, /its public half does not match/],
  ] as const) {
    assert.throws(
      () => parseSecretKey(bad, '"parentKey" in settings'),
      (e: Error) => e instanceof KeyError && why.test(e.message) && e.message.startsWith('"parentKey" in settings') && !e.message.includes(bad.slice(8, 30)),
    );
  }
});

// ---- The testnet-only guard ----

test("settings make a real payer only for a testnet parent account with its key; with neither, there is none", () => {
  const { text } = freshKey();
  assert.equal(testnetPayer({}), null);
  const payer = testnetPayer({ parentAccount: "sumi.testnet", parentKey: text })!;
  assert.equal(payer.describe, "testnet payer (real transfers: the Fee from payer.sumi.testnet to sumi.testnet, Payouts from sumi.testnet)");
  assert.equal(payer.accountOf("attacker"), "attacker.sumi.testnet");
  assert.equal(payer.explorer, "https://testnet.nearblocks.io/txns/");
  for (const [settings, why] of [
    [{ parentAccount: "sumi.near", parentKey: text }, /Payments are sent on testnet only: "sumi.near" is not a testnet account/],
    [{ parentAccount: "sumi.testnet.near", parentKey: text }, /not a testnet account/],
    [{ parentAccount: "sumi.testnet" }, /must give both "parentAccount" and "parentKey"/],
    [{ parentKey: text }, /must give both/],
    [{ parentAccount: "sumi.testnet", parentKey: "nope" }, /"parentKey" in settings must look like/],
  ] as const) {
    assert.throws(() => testnetPayer(settings), (e: Error) => why.test(e.message) && !e.message.includes(text.slice(8)));
  }
  // The settings file's optional fields: empty strings mean "not set", and the RPC can be named.
  const raw = { nearAiKey: "k", models: Object.fromEntries(["scout", "rules", "attacker", "prover", "referee", "reporter"].map((a) => [a, "m"])), prices: { m: { inputPerMillion: 1, outputPerMillion: 1 } } };
  assert.equal(testnetPayer(parseSettings({ ...raw, parentAccount: "", parentKey: "" })), null);
  assert.equal(parseSettings({ ...raw, testnetRpc: "https://example.test" }).testnetRpc, "https://example.test");
});

test("a testnet payer sends nothing through an RPC that is not on testnet", async () => {
  const methods: string[] = [];
  const mainnet: FetchLike = async (_url, init) => {
    const { method } = JSON.parse(init.body);
    methods.push(method);
    return new Response(JSON.stringify({ result: { chain_id: "mainnet" } }));
  };
  const payer = new NearPayments({ rpc: new NearRpc("https://rpc.example", mainnet), parentAccount: "sumi.testnet", key: parseSecretKey(freshKey().text, "k"), network: "testnet" });
  const refused = (e: Error) => e instanceof PaymentError && /Payments are sent on testnet only, but the RPC at https:\/\/rpc\.example is on "mainnet"\. Nothing was sent\./.test(e.message);
  await assert.rejects(payer.collectFee("1"), refused);
  await assert.rejects(payer.send({ agent: "scout", yoctoNear: "1" }), refused);
  await assert.rejects(payer.setup(() => {}), refused);
  assert.ok(methods.every((m) => m === "status"), "only the network was asked for: no account was read and no transaction was sent");
});

// ---- An Audit that pays for real, from the fixed vault's Recording ----

const FIXED = new URL("../recordings/live-fixed-vault.json", import.meta.url).pathname;
const SECRET = "sk-test-do-not-print-0123456789";

/** Stands in for the testnet payer: returns a hash per payment, and can be told to fail. */
class StubPayer implements Payer {
  readonly describe = "testnet payer (real transfers: the Fee from payer.sumi.testnet to sumi.testnet, Payouts from sumi.testnet)";
  readonly explorer = "https://testnet.nearblocks.io/txns/";
  readonly sent: PayoutOrder[] = [];
  private readonly fail: { fee?: string; payoutTo?: string };
  constructor(fail: { fee?: string; payoutTo?: string } = {}) {
    this.fail = fail;
  }
  async collectFee(): Promise<{ hash: string }> {
    if (this.fail.fee) throw new PaymentError(this.fail.fee);
    return { hash: "FeeHash111" };
  }
  async send(order: PayoutOrder): Promise<{ hash: string }> {
    if (order.agent === this.fail.payoutTo) throw new PaymentError('the transaction failed on chain: {"ActionError":{"kind":{"AccountDoesNotExist":{"account_id":"prover.sumi.testnet"}}}}');
    this.sent.push(order);
    return { hash: `PayoutHash${this.sent.length}` };
  }
}

const reporterWords = JSON.stringify({
  summary: "Every Rule held.",
  rules: ["R1", "R2", "R3", "R4", "R5"].map((rule) => ({ rule, text: "Proven against the Lean description." })),
  findings: [],
  conflicts: [],
});

/** A live Audit of the fixed vault whose LLM answers and toolchain outcomes come from its Recording, paid by `payer`. */
async function paidAudit(payer: Payer) {
  const recorded = await loadRecording(FIXED);
  recorded.exchanges.push({ agent: "reporter", answer: reporterWords, tokens: { input: 5000, output: 500 }, usd: 0.004 });
  const llm = new ReplayGateway(recorded.exchanges);
  const asked: string[] = [];
  const outDir = await mkdtemp(join(tmpdir(), "nearwatch-paid-"));
  const settings = parseSettings({
    nearAiKey: SECRET,
    models: Object.fromEntries(["scout", "rules", "attacker", "prover", "referee", "reporter"].map((a) => [a, "m"])),
    prices: { m: { inputPerMillion: 1, outputPerMillion: 1 } },
  });
  const run = liveAudit({
    contractPath: recorded.contract.path,
    outDir,
    settings,
    llm: () => ({
      ask: (agent, prompt) => {
        asked.push(agent);
        return llm.ask(agent, prompt);
      },
    }),
    toolchain: new ReplayToolchain(recorded.toolchain),
    payer,
  });
  return { run, outDir, asked };
}

test("an Audit pays its Fee first and prints the hash of every payment; the Recording stores them and replay returns them", async () => {
  const payer = new StubPayer();
  const { run, outDir } = await paidAudit(payer);
  const { result, recordingPath } = await run;
  const t = result!.transcript;

  assert.equal(t[1], `Payer: ${payer.describe}`);
  assert.equal(t[2], "Fee: 1 NEAR, moved from the payer's account to the parent account [FeeHash111]");
  assert.ok(t.indexOf("== Scout ==") > 2, "the Fee is collected before any agent runs");
  assert.ok(!t.some((l) => l.includes("SIMULATED")));
  for (const line of [
    "  scout: 0.05 NEAR (5% flat share) [PayoutHash1]",
    "  reporter: 0.05 NEAR (5% flat share) [PayoutHash3]",
    "  prover: 0.12 NEAR (R5 Proven) [PayoutHash9]",
    "  Look up any hash at https://testnet.nearblocks.io/txns/<hash>",
  ]) {
    assert.ok(t.includes(line), `the transcript shows: ${line}`);
  }
  // The Payouts are the Fee, exactly.
  assert.equal(result!.payouts.reduce((s, p) => s + BigInt(p.yoctoNear), 0n), 10n ** 24n);
  assert.deepEqual(result!.fee, { yoctoNear: (10n ** 24n).toString(), hash: "FeeHash111" });

  const recording = await loadRecording(recordingPath);
  assert.deepEqual(recording.fee, result!.fee);
  assert.deepEqual(recording.payouts, result!.payouts.map((p) => ({ agent: p.to, yoctoNear: p.yoctoNear, hash: p.hash })));
  assert.equal(recording.settings.payer, payer.describe);
  assert.ok(!JSON.stringify(recording).includes(SECRET));
  assert.equal(JSON.parse(await readFile(join(outDir, "payouts.json"), "utf8")).fee.hash, "FeeHash111");

  // Replay sends nothing and prints the same transcript, hashes included.
  const replayed = await runAudit(recording.contract.path, replayPorts(recording), auditOptionsFrom(recording.settings));
  assert.deepEqual(replayed.transcript, t);
  assert.deepEqual(replayed.payouts, result!.payouts);

  // A Recording whose Payouts do not match what the Ledger works out fails the replay clearly.
  const altered: Recording = structuredClone(recording);
  altered.payouts[4] = { ...altered.payouts[4]!, agent: "attacker" };
  await assert.rejects(
    runAudit(altered.contract.path, replayPorts(altered), auditOptionsFrom(altered.settings)),
    (e: Error) => e instanceof ReplayError && /Replay asked for Payout #5 \(120000000000000000000000 yoctoNEAR to prover\), but the Recording holds 120000000000000000000000 to attacker there/.test(e.message),
  );
});

test("a Payout that fails is listed as not paid, the rest are still paid, and the verdicts and the folder are saved", async () => {
  const payer = new StubPayer({ payoutTo: "prover" });
  const { run, outDir } = await paidAudit(payer);
  const { result, recordingPath } = await run;
  const t = result!.transcript;

  assert.deepEqual(result!.verdicts, { R1: "Proven", R2: "Proven", R3: "Proven", R4: "Proven", R5: "Proven" });
  const unpaid = result!.payouts.filter((p) => p.hash === null);
  assert.equal(unpaid.length, 5);
  assert.ok(unpaid.every((p) => p.to === "prover" && /AccountDoesNotExist/.test(p.error!)));
  assert.equal(payer.sent.length, 4, "the Scout, Rules agent, Reporter and Referee were still paid");
  assert.ok(t.some((l) => l.startsWith("  NOT PAID prover: 0.12 NEAR (R1 Proven): the transaction failed on chain:")));
  assert.ok(
    t.includes("  ** 5 Payouts were not paid, 0.6 NEAR in all: prover 0.12 NEAR, prover 0.12 NEAR, prover 0.12 NEAR, prover 0.12 NEAR, prover 0.12 NEAR. **"),
  );
  assert.ok(t.includes("  That money is still in the parent account. The verdicts and the Audit's results are saved."));

  // Everything the Audit wrote is there, and the Recording replays to the same transcript, failures included.
  for (const file of ["transcript.txt", "rules.json", "report.md", "payouts.json", "recording.json"]) await readFile(join(outDir, file), "utf8");
  const recording = await loadRecording(recordingPath);
  assert.equal(recording.payouts.filter((p) => "error" in p).length, 5);
  const replayed = await runAudit(recording.contract.path, replayPorts(recording), auditOptionsFrom(recording.settings));
  assert.deepEqual(replayed.transcript, t);
});

test("when the Fee cannot be collected, no agent runs and the reason is given", async () => {
  const { run, asked } = await paidAudit(new StubPayer({ fee: "The payer account payer.sumi.testnet holds 0.2 NEAR, not enough for the 1 NEAR Fee and gas. Run: npm run setup-accounts" }));
  await assert.rejects(
    run,
    (e: Error) =>
      e instanceof PaymentError &&
      e.message === "The Fee could not be collected, so no agent was run and nothing was spent. The payer account payer.sumi.testnet holds 0.2 NEAR, not enough for the 1 NEAR Fee and gas. Run: npm run setup-accounts",
  );
  assert.deepEqual(asked, []);
});

test("with no testnet account in settings, the Audit runs with the fake payer and says so; its Recording stores no payments", async () => {
  const recorded = await loadRecording(FIXED);
  const result = await runAudit(recorded.contract.path, replayPorts(recorded), auditOptionsFrom(recorded.settings));
  assert.equal(result.transcript[1], "Payer: fake payer (records Payouts, sends nothing)");
  assert.equal(result.transcript[2], "Fee: 1 NEAR (simulated: the fake payer moves nothing) [fake-fee]");
  assert.ok(result.transcript.includes("  SIMULATED: the fake payer records these Payouts and sends nothing on chain."));
  assert.equal(recorded.fee, undefined);
  assert.deepEqual(recorded.payouts, []);
});
