// Slow: the real payer (hand-signed NEAR transactions over JSON-RPC) against a local sandbox node, the same
// nearcore binary the Rust harness runs Scenarios in. Nothing here touches testnet. Skips when the sandbox
// binary has not been built (it is fetched by `cargo build` in rust/, as for test/sandbox.slow.test.ts).
import assert from "node:assert/strict";
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { existsSync, globSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { parseSecretKey } from "../src/near/keys.ts";
import { AGENT_START_YOCTO, NearPayments, PAYER_TARGET_YOCTO, testnetPayer } from "../src/near/payments.ts";
import { NearRpc } from "../src/near/rpc.ts";
import { PaymentError } from "../src/ports.ts";
import { AGENT_NAMES } from "../src/settings.ts";

const binary = globSync(new URL("../rust/target/*/build/near-sandbox-*/out/.near/near-sandbox-*/near-sandbox", import.meta.url).pathname).find((p) => existsSync(p));
const skip = binary ? false : "the near-sandbox binary is not built (run `cargo build --release` in rust/)";
// The macOS sandbox binary links Homebrew's liblzma by absolute path; /usr/lib has the same library (see rust/harness).
const env = { ...process.env, DYLD_FALLBACK_LIBRARY_PATH: process.env.DYLD_FALLBACK_LIBRARY_PATH ?? "/usr/local/lib:/usr/lib" };

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });

const NEAR = 10n ** 24n;
let node: ChildProcess | undefined;
let home = "";
let rpc: NearRpc;
let payments: NearPayments;
let chain = "";

before(async () => {
  if (skip) return;
  home = await mkdtemp(join(tmpdir(), "nearwatch-sandbox-"));
  execFileSync(binary!, ["--home", home, "init"], { env, stdio: "ignore" });
  const [rpcPort, netPort] = [await freePort(), await freePort()];
  node = spawn(binary!, ["--home", home, "run", "--rpc-addr", `127.0.0.1:${rpcPort}`, "--network-addr", `127.0.0.1:${netPort}`], { env, stdio: "ignore" });
  rpc = new NearRpc(`http://127.0.0.1:${rpcPort}`);
  for (let i = 0; ; i++) {
    try {
      chain = await rpc.chainId();
      break;
    } catch (e) {
      if (i > 150) throw e;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  // The sandbox's own funded account plays the builder's parent account.
  const validator = JSON.parse(readFileSync(join(home, "validator_key.json"), "utf8"));
  payments = new NearPayments({ rpc, parentAccount: validator.account_id, key: parseSecretKey(validator.secret_key, "the sandbox key"), network: chain });
});

after(async () => {
  node?.kill("SIGKILL");
  if (home) await rm(home, { recursive: true, force: true });
});

const balance = async (account: string) => (await rpc.account(account))?.yoctoNear ?? null;

test("on a real node: setup creates the payer's and every agent's account under the parent, and a second run changes nothing", { skip }, async () => {
  const first: string[] = [];
  await payments.setup((l) => first.push(l));
  assert.equal(first.filter((l) => /: created with /.test(l)).length, 7);
  for (const agent of AGENT_NAMES) assert.equal(await balance(`${agent}.test.near`), AGENT_START_YOCTO);
  assert.equal(await balance("payer.test.near"), PAYER_TARGET_YOCTO);
  // Every sub-account holds the parent's key, so the one key signs for the payer too.
  assert.ok(await rpc.accessKey("payer.test.near", parseSecretKey(JSON.parse(readFileSync(join(home, "validator_key.json"), "utf8")).secret_key, "k").publicKeyText));

  const second: string[] = [];
  await payments.setup((l) => second.push(l));
  assert.equal(second.filter((l) => /already exists with .* left alone/.test(l)).length, 7);
  assert.ok(!second.some((l) => /created|topped up/.test(l)));
});

test("on a real node: the Fee moves from the payer to the parent, Payouts move from the parent to the agents, and each hash is the transaction's", { skip }, async () => {
  const parentBefore = (await balance("test.near"))!;
  const payerBefore = (await balance("payer.test.near"))!;
  const fee = await payments.collectFee(NEAR.toString());
  assert.match(fee.hash, /^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
  const payerAfter = (await balance("payer.test.near"))!;
  // The payer pays the Fee and a little gas; the parent receives the whole Fee.
  assert.ok(payerBefore - payerAfter >= NEAR && payerBefore - payerAfter < NEAR + NEAR / 1000n);

  const paid = await payments.send({ agent: "attacker", yoctoNear: ((NEAR * 12n) / 100n).toString() });
  const back = await payments.send({ agent: "payer", yoctoNear: ((NEAR * 5n) / 100n).toString() });
  assert.notEqual(paid.hash, back.hash);
  assert.notEqual(paid.hash, fee.hash);
  assert.equal(await balance("attacker.test.near"), AGENT_START_YOCTO + NEAR * 12n / 100n);
  // The payer got its 0.05 NEAR back (and, a block later, the unused gas of its Fee transfer).
  const payerEnd = (await balance("payer.test.near"))!;
  assert.ok(payerEnd >= payerAfter + (NEAR * 5n) / 100n && payerEnd < payerAfter + (NEAR * 5n) / 100n + NEAR / 1000n);
  const parentAfter = (await balance("test.near"))!;
  const kept = parentAfter - parentBefore;
  // The Fee less the two Payouts, give or take gas (and refunds of gas from earlier transactions landing late).
  const expected = NEAR - (NEAR * 17n) / 100n;
  const off = kept > expected ? kept - expected : expected - kept;
  assert.ok(off < NEAR / 1000n, `the parent should keep the Fee less the two Payouts, but its balance changed by ${kept}`);

  // The node knows each transaction by the hash the payer returned.
  const res = await fetch(rpc.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tx", params: { tx_hash: paid.hash, sender_account_id: "test.near" } }),
  });
  const tx = (await res.json()) as { result: { transaction: { hash: string; receiver_id: string } } };
  assert.equal(tx.result.transaction.hash, paid.hash);
  assert.equal(tx.result.transaction.receiver_id, "attacker.test.near");
});

test("on a real node: a payer short of the Fee, and a payer made for another network, send nothing and say why", { skip }, async () => {
  const held = (await balance("payer.test.near"))!;
  await assert.rejects(payments.collectFee((held + 1n).toString()), (e: Error) => e instanceof PaymentError && /holds .* NEAR, not enough for the .* Fee and gas\. Run: npm run setup-accounts/.test(e.message));
  assert.equal(await balance("payer.test.near"), held);

  // The same node, but a payer that may only pay on testnet: it refuses before signing anything.
  const validator = JSON.parse(readFileSync(join(home, "validator_key.json"), "utf8"));
  const testnetOnly = new NearPayments({ rpc, parentAccount: "test.near", key: parseSecretKey(validator.secret_key, "k"), network: "testnet" });
  const refused = (e: Error) => e instanceof PaymentError && e.message === `Payments are sent on testnet only, but the RPC at ${rpc.url} is on "${chain}". Nothing was sent.`;
  await assert.rejects(testnetOnly.collectFee(NEAR.toString()), refused);
  await assert.rejects(testnetOnly.send({ agent: "scout", yoctoNear: "1" }), refused);
  await assert.rejects(testnetOnly.setup(() => {}), refused);
  assert.equal(await balance("scout.test.near"), AGENT_START_YOCTO);
  assert.notEqual(chain, "testnet");
  // And settings that name a parent off testnet never make a payer at all.
  assert.throws(() => testnetPayer({ parentAccount: "test.near", parentKey: validator.secret_key }), /Payments are sent on testnet only: "test.near" is not a testnet account/);
});
