// Slow: the vaults deployed with hand-signed transactions to a local sandbox node (the same nearcore binary the
// Rust harness runs Scenarios in), and the planted bug shown there with real calls. Nothing here touches
// testnet. Skips when the sandbox binary or cargo is missing.
import assert from "node:assert/strict";
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { existsSync, globSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { DEMO_AMOUNT_YOCTO, DeployError, VaultDeployer } from "../src/near/deploy.ts";
import { parseSecretKey } from "../src/near/keys.ts";
import { NearRpc } from "../src/near/rpc.ts";
import { buildContract, findCargo } from "../src/sandbox.ts";

const binary = globSync(new URL("../rust/target/*/build/near-sandbox-*/out/.near/near-sandbox-*/near-sandbox", import.meta.url).pathname).find((p) => existsSync(p));
const skip = !findCargo() ? "cargo is not installed (see rust/README.md)" : binary ? false : "the near-sandbox binary is not built (run `cargo build --release` in rust/)";
const env = { ...process.env, DYLD_FALLBACK_LIBRARY_PATH: process.env.DYLD_FALLBACK_LIBRARY_PATH ?? "/usr/local/lib:/usr/lib" };
const ROOT = new URL("..", import.meta.url).pathname;
const wasmOf = async (vault: string) => readFile(await buildContract(join(ROOT, "rust", "vaults", vault, "src", "lib.rs")));

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });

let node: ChildProcess | undefined;
let home = "";
let rpc: NearRpc;
let deployer: VaultDeployer;
let chain = "";
let secret = "";

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
  secret = validator.secret_key;
  deployer = new VaultDeployer({ rpc, parentAccount: validator.account_id, key: parseSecretKey(secret, "the sandbox key"), network: chain });
});

after(async () => {
  node?.kill("SIGKILL");
  if (home) await rm(home, { recursive: true, force: true });
});

test("on a real node: both vaults are deployed and initialized under the parent, and deploying the same code again sends nothing", { skip }, async () => {
  for (const vault of ["buggy", "fixed"] as const) {
    const first = await deployer.deploy(vault, await wasmOf(vault));
    assert.equal(first.action, "created");
    assert.equal(first.account, `${vault}-vault.test.near`);
    assert.match(first.hash!, /^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
    assert.equal(await rpc.view(first.account, "owner", {}), "test.near");
    assert.equal(await rpc.view(first.account, "deposits_paused", {}), false);
    assert.deepEqual(await deployer.deploy(vault, await wasmOf(vault)), { account: first.account, hash: null, action: "unchanged" });
  }
});

test("on a real node: a withdrawal to a missing account loses the balance in the buggy vault and not in the fixed one", { skip }, async () => {
  const buggy = await deployer.demonstrate("buggy");
  assert.equal(buggy.transferFailed, true);
  assert.equal(buggy.ledgerBefore, DEMO_AMOUNT_YOCTO.toString());
  assert.equal(buggy.ledgerAfter, "0");
  assert.equal(buggy.balanceLost, true);
  // The NEAR came back to the vault: it holds the deposit, but its ledger no longer owes it to anyone.
  assert.ok((await rpc.account("buggy-vault.test.near"))!.yoctoNear > 0n);

  const fixed = await deployer.demonstrate("fixed");
  assert.equal(fixed.transferFailed, true);
  assert.equal(fixed.ledgerBefore, DEMO_AMOUNT_YOCTO.toString());
  assert.equal(fixed.ledgerAfter, DEMO_AMOUNT_YOCTO.toString());
  assert.equal(fixed.balanceLost, false);
  assert.notEqual(buggy.withdrawHash, fixed.withdrawHash);
});

test("on a real node: changed code replaces the old, and a deployer made for testnet sends nothing to another network", { skip }, async () => {
  // The fixed vault's code put on the buggy vault's account: an update, signed by that account.
  const updated = await deployer.deploy("buggy", await wasmOf("fixed"));
  assert.equal(updated.action, "updated");
  assert.equal((await deployer.demonstrate("buggy")).balanceLost, false, "the buggy vault's account now runs the fixed code");

  const testnetOnly = new VaultDeployer({ rpc, parentAccount: "test.near", key: parseSecretKey(secret, "k"), network: "testnet" });
  const refused = (e: Error) => e instanceof DeployError && e.message === `The vaults are deployed on testnet only, but the RPC at ${rpc.url} is on "${chain}". Nothing was sent.`;
  await assert.rejects(testnetOnly.deploy("fixed", await wasmOf("buggy")), refused);
  await assert.rejects(testnetOnly.demonstrate("fixed"), refused);
  assert.notEqual(chain, "testnet");
});
