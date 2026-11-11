// Audit command: `npm run audit -- <contract path> [--settings file] [--out folder]`.
import { parseArgs } from "node:util";
import { liveAudit } from "../live-audit.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { settings: { type: "string" }, out: { type: "string" } },
});
const contractPath = positionals[0];

if (!contractPath) {
  console.error("usage: npm run audit -- <contract .rs file or near-sdk crate folder> [--settings settings.local.json] [--out folder]");
  process.exitCode = 2;
} else {
  const outDir = values.out ?? `audits/${new Date().toISOString().replace(/[:.]/g, "-")}`;
  try {
    const { result, recordingPath } = await liveAudit({ contractPath, outDir, settings: values.settings });
    console.log(result!.transcript.join("\n"));
    console.log(`\nRecording: ${recordingPath}  (replay with: npm run replay -- ${recordingPath})`);
  } catch (e) {
    console.error(`audit failed: ${(e as Error).message}`);
    process.exitCode = 1;
  }
}
