// Settings for live runs, read from `settings.local.json` (never committed; see settings.example.json).

import { readFile } from "node:fs/promises";
import type { AgentName } from "./domain.ts";

export const AGENT_NAMES: readonly AgentName[] = ["scout", "rules", "attacker", "prover", "referee", "reporter"];
export const DEFAULT_SPEND_CAP_USD = 5;
export const DEFAULT_BASE_URL = "https://cloud-api.near.ai/v1";
export const SETTINGS_FILE = "settings.local.json";

/** Dollars per million tokens in and out. */
export interface Price {
  inputPerMillion: number;
  outputPerMillion: number;
}

export interface Settings {
  nearAiKey: string;
  baseUrl: string;
  /** The model for each agent. */
  models: Record<AgentName, string>;
  /** Price per model id. Every model in `models` must have one. */
  prices: Record<string, Price>;
  spendCapUsd: number;
  /** Testnet accounts (ticket 10). Optional until then. */
  parentAccount?: string;
  parentKey?: string;
}

export class SettingsError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const nonNeg = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0;

/** Checks raw settings. Error messages name the field and never echo a key's value. */
export function parseSettings(raw: unknown, source = SETTINGS_FILE): Settings {
  const bad = (msg: string): never => {
    throw new SettingsError(`${source}: ${msg}`);
  };
  if (!isObj(raw)) return bad("expected a JSON object");

  const nearAiKey = raw.nearAiKey;
  if (typeof nearAiKey !== "string" || nearAiKey.trim() === "") bad('"nearAiKey" is missing or empty');

  const baseUrl = raw.baseUrl ?? DEFAULT_BASE_URL;
  if (typeof baseUrl !== "string" || !/^https?:\/\//.test(baseUrl)) bad('"baseUrl" must be an http(s) URL');

  if (!isObj(raw.models)) return bad('"models" must map each agent to a model id');
  const models = {} as Record<AgentName, string>;
  for (const agent of AGENT_NAMES) {
    const m = raw.models[agent];
    if (typeof m !== "string" || m === "") bad(`"models.${agent}" is missing`);
    models[agent] = m as string;
  }

  if (!isObj(raw.prices)) return bad('"prices" must map each model id to {inputPerMillion, outputPerMillion}');
  const prices: Record<string, Price> = {};
  for (const [model, p] of Object.entries(raw.prices)) {
    if (!isObj(p) || !nonNeg(p.inputPerMillion) || !nonNeg(p.outputPerMillion)) {
      bad(`"prices.${model}" must be {"inputPerMillion": number, "outputPerMillion": number}`);
    }
    const q = p as Record<string, number>;
    prices[model] = { inputPerMillion: q.inputPerMillion!, outputPerMillion: q.outputPerMillion! };
  }
  for (const agent of AGENT_NAMES) {
    if (!prices[models[agent]]) bad(`no price for model "${models[agent]}" (used by ${agent}); add it under "prices"`);
  }

  const spendCapUsd = raw.spendCapUsd ?? DEFAULT_SPEND_CAP_USD;
  if (!nonNeg(spendCapUsd)) bad('"spendCapUsd" must be a number of dollars, 0 or more');

  const opt = (k: "parentAccount" | "parentKey") => {
    const v = raw[k];
    if (v === undefined || v === "") return undefined;
    if (typeof v !== "string") bad(`"${k}" must be a string`);
    return v as string;
  };

  return {
    nearAiKey: (nearAiKey as string).trim(),
    baseUrl: (baseUrl as string).replace(/\/+$/, ""),
    models,
    prices,
    spendCapUsd: spendCapUsd as number,
    parentAccount: opt("parentAccount"),
    parentKey: opt("parentKey"),
  };
}

export async function loadSettings(path = SETTINGS_FILE): Promise<Settings> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    throw new SettingsError(`Cannot read ${path}. Copy settings.example.json to ${path} and fill in your NEAR AI key.`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new SettingsError(`${path} is not valid JSON: ${(e as Error).message}`);
  }
  return parseSettings(raw, path);
}

/** Dollars for one call. */
export function priceCall(price: Price, tokens: { input: number; output: number }): number {
  return (tokens.input * price.inputPerMillion + tokens.output * price.outputPerMillion) / 1_000_000;
}

/** The settings safe to store in a Recording: everything except keys. */
export function publicSettings(s: Settings): Record<string, unknown> {
  return { baseUrl: s.baseUrl, models: s.models, prices: s.prices, spendCapUsd: s.spendCapUsd };
}
