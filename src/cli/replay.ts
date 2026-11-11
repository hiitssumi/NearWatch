// Replay command: reads arguments, runs the Audit from a Recording, prints the transcript.
import { parseArgs } from "node:util";
import { runAudit } from "../audit.ts";
import { loadRecording, replayPorts } from "../replay/recording.ts";

const DEFAULT_RECORDING = new URL("../../recordings/hand-made.json", import.meta.url).pathname;

const { positionals } = parseArgs({ allowPositionals: true });
const path = positionals[0] ?? DEFAULT_RECORDING;

try {
  const recording = await loadRecording(path);
  console.log(`Replaying ${path} (commit ${recording.commit})\n`);
  const result = await runAudit(recording.contract.path, replayPorts(recording));
  console.log(result.transcript.join("\n"));
} catch (e) {
  console.error(`replay failed: ${(e as Error).message}`);
  process.exitCode = 1;
}
