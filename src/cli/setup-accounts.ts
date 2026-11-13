// Setup command: `npm run setup-accounts -- [--settings file]`.
// Creates the payer's account and one account per agent under the parent account named in settings, on NEAR
// testnet, and brings the payer's balance up to what an Audit needs. Safe to run again.
import { parseArgs } from "node:util";
import { testnetPayer } from "../near/payments.ts";
import { loadSettings } from "../settings.ts";

const { values } = parseArgs({ options: { settings: { type: "string" } } });

try {
  const settings = await loadSettings(values.settings);
  const payer = testnetPayer(settings);
  if (!payer) {
    console.error('setup-accounts needs "parentAccount" (a .testnet account) and "parentKey" (its secret key) in the settings file.');
    process.exitCode = 2;
  } else {
    console.log(payer.describe);
    await payer.setup((line) => console.log(line));
    console.log("\nDone. An Audit now pays its Fee and Payouts on testnet: npm run audit -- <contract>");
  }
} catch (e) {
  console.error(`setup-accounts failed: ${(e as Error).message}`);
  process.exitCode = 1;
}
