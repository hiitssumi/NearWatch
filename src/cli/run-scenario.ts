// Re-runs one Scenario file written by a live Audit: `npm run scenario -- <audit folder>/scenarios/S1.json`.
// Runs it in a fresh local sandbox and prints what the harness observed and whether the Rule check is true.
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import type { ScenarioFile } from "../live-audit.ts";
import { LocalSandbox } from "../sandbox.ts";

const { positionals } = parseArgs({ allowPositionals: true });
const path = positionals[0];

if (!path) {
  console.error("usage: npm run scenario -- <scenario .json file from an Audit's scenarios folder>");
  process.exitCode = 2;
} else {
  try {
    const file = JSON.parse(await readFile(path, "utf8")) as ScenarioFile;
    console.log(`Scenario ${file.scenario.id} against ${file.rule.id}: ${file.rule.text}`);
    console.log(`Contract: ${file.contractPath}\n`);
    const outcome = await new LocalSandbox().runScenario(file.contractPath, file.scenario, file.rule.check);
    console.log(JSON.stringify(outcome.observations, null, 2));
    console.log(`\nRule check: ${outcome.ruleCheckTrue ? "TRUE (the Rule is broken)" : "false (the Rule held)"}`);
  } catch (e) {
    console.error(`scenario failed: ${(e as Error).message}`);
    process.exitCode = 1;
  }
}
