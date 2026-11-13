// Re-checks every hand-written Lean case with the local Lean install and stores the outcomes in
// lean-outcomes.json, which the fast tests replay. Run: npm run record-lean
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { findLean, LocalLean } from "../../src/lean.ts";
import { CASES, caseProperty } from "./cases.ts";

const lean = new LocalLean();
const version = execFileSync(findLean()!, ["--version"], { encoding: "utf8" }).trim();
const outcomes: Record<string, unknown> = {};
for (const [name, c] of Object.entries(CASES)) {
  outcomes[name] = await lean.checkLean(c.formalization, caseProperty(c), c.body);
  console.log(`${name}: ${JSON.stringify(outcomes[name]).slice(0, 120)}`);
}
writeFileSync(
  new URL("lean-outcomes.json", import.meta.url),
  `${JSON.stringify({ note: "Test material only. Made by test/lean/record-outcomes.ts.", lean: version, outcomes }, null, 2)}\n`,
);
