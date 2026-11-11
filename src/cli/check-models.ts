// Calls each model named in settings once, because the catalog's readiness flag is not understood.
// `npm run check-models -- [--settings file]`
import { parseArgs } from "node:util";
import { LiveGateway } from "../llm/live.ts";
import { AGENT_NAMES, loadSettings } from "../settings.ts";

const { values } = parseArgs({ options: { settings: { type: "string" } } });

try {
  const settings = await loadSettings(values.settings);
  const gateway = new LiveGateway(settings);
  const models = [...new Set(AGENT_NAMES.map((a) => settings.models[a]))];
  let failed = 0;
  for (const model of models) {
    const users = AGENT_NAMES.filter((a) => settings.models[a] === model).join(", ");
    try {
      const r = await gateway.askModel(model, 'Reply with exactly this JSON: {"ok": true}');
      const ok = /"ok"\s*:\s*true/.test(r.answer);
      if (!ok) failed++;
      console.log(`${ok ? "OK  " : "ODD "} ${model} (${users}): ${r.tokens.input} in, ${r.tokens.output} out, $${r.usd!.toFixed(6)}; answer ${JSON.stringify(r.answer.slice(0, 80))}`);
    } catch (e) {
      failed++;
      console.log(`FAIL ${model} (${users}): ${(e as Error).message}`);
    }
  }
  process.exitCode = failed === 0 ? 0 : 1;
} catch (e) {
  console.error(`check-models failed: ${(e as Error).message}`);
  process.exitCode = 1;
}
