// Replay command: reads arguments, runs the Audit from a Recording, prints the transcript.
import { parseArgs } from "node:util";
import { auditOptionsFrom, runAudit } from "../audit.ts";
import { loadRecording, replayPorts } from "../replay/recording.ts";

const DEFAULT_RECORDING = new URL("../../recordings/hand-made.json", import.meta.url).pathname;

const { positionals } = parseArgs({ allowPositionals: true });
const path = positionals[0] ?? DEFAULT_RECORDING;

try {
  const recording = await loadRecording(path);
  console.log(`Replaying ${path} (commit ${recording.commit})`);
  if (recording.fee) console.log("This Audit paid on NEAR testnet. Replay prints the recorded transaction hashes and sends nothing.");
  console.log("");
  const result = await runAudit(recording.contract.path, replayPorts(recording), auditOptionsFrom(recording.settings));
  console.log(result.transcript.join("\n"));
} catch (e) {
  console.error(`replay failed: ${(e as Error).message}`);
  process.exitCode = 1;
}
