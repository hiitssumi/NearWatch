// Deploy command: `npm run deploy-vaults -- [--settings file] [--no-demo]`.
// Builds the buggy and the fixed vault, deploys each to its own account under the parent account on NEAR
// testnet, and (unless --no-demo) shows the planted bug there with real calls: a deposit, then a withdrawal to
// an account that does not exist. Writes what it did to deployments/testnet.json. Safe to run again.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { type Demonstration, testnetDeployer, TESTNET_EXPLORER_ACCOUNT, VAULTS, type VaultName } from "../near/deploy.ts";
import { TESTNET_EXPLORER_TX } from "../near/payments.ts";
import { buildContract } from "../sandbox.ts";
import { loadSettings } from "../settings.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const OUT = join(ROOT, "deployments", "testnet.json");
const near = (yocto: string) => `${Number(BigInt(yocto) / 10n ** 21n) / 1000} NEAR`;

const { values } = parseArgs({ options: { settings: { type: "string" }, "no-demo": { type: "boolean" } } });

try {
  const settings = await loadSettings(values.settings);
  const deployer = testnetDeployer(settings);
  if (!deployer) {
    console.error('deploy-vaults needs "parentAccount" (a .testnet account) and "parentKey" (its secret key) in the settings file.');
    process.exitCode = 2;
  } else {
    const record: { network: string; parent: string; vaults: Record<string, { account: string; explorer: string; deployHash?: string }>; demonstrations: Demonstration[] } = {
      network: "testnet",
      parent: deployer.parent,
      vaults: {},
      demonstrations: [],
    };
    try {
      Object.assign(record, JSON.parse(await readFile(OUT, "utf8")), { demonstrations: [] });
    } catch {
      // First run: nothing recorded yet.
    }

    for (const vault of VAULTS) {
      process.stdout.write(`Building the ${vault} vault... `);
      const wasm = await readFile(await buildContract(join(ROOT, "rust", "vaults", vault, "src", "lib.rs")));
      const { account, hash, action } = await deployer.deploy(vault, wasm);
      console.log(`${account}: ${action}${hash ? ` [${TESTNET_EXPLORER_TX}${hash}]` : " (this code is already deployed)"}`);
      record.vaults[vault] = { account, explorer: `${TESTNET_EXPLORER_ACCOUNT}${account}`, deployHash: hash ?? record.vaults[vault]?.deployHash };
    }

    if (!values["no-demo"]) {
      const amount = near("100000000000000000000000");
      console.log(`\nOn each vault: ${deployer.parent} deposits ${amount}, then withdraws ${amount} to ${deployer.receiver}, which does not exist.`);
      for (const vault of VAULTS as readonly VaultName[]) {
        const d = await deployer.demonstrate(vault);
        record.demonstrations.push(d);
        console.log(`\n${vault} vault (${d.account})`);
        console.log(`  deposit  ${TESTNET_EXPLORER_TX}${d.depositHash}`);
        console.log(`  withdraw ${TESTNET_EXPLORER_TX}${d.withdrawHash}`);
        console.log(`  the transfer to ${d.receiver} ${d.transferFailed ? "failed, as expected" : "did NOT fail"}`);
        console.log(`  ${deployer.parent}'s recorded balance: ${near(d.ledgerBefore)} before the withdrawal, ${near(d.ledgerAfter)} after`);
        console.log(`  => ${d.balanceLost ? `the balance was taken although the NEAR never left the vault: ${amount} lost (the planted bug)` : "the balance was restored: nothing lost"}`);
      }
    }

    await mkdir(join(ROOT, "deployments"), { recursive: true });
    await writeFile(OUT, `${JSON.stringify(record, null, 2)}\n`);
    console.log(`\nWrote deployments/testnet.json`);
  }
} catch (e) {
  console.error(`deploy-vaults failed: ${(e as Error).message}`);
  process.exitCode = 1;
}
