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
  /**
   * Extra request fields merged into the chat completions body, keyed by model id or by agent name. An
   * agent's own extras apply on top of its model's. Used to turn off the Attacker model's thinking, which
   * otherwise runs past the call timeout on an Attacker round. An agent key such as "rules" with
   * {"reasoning_effort": "low"} makes cheap rehearsal runs (GLM-5.3 on NEAR AI honours `reasoning_effort`,
   * not `thinking`), but the Rules agent then wrote a false Property, so it is off by default.
   */
  requestExtras: Record<string, Record<string, unknown>>;
  /**
   * The builder's testnet parent account and its secret key ("ed25519:..."), for real Payouts. With neither,
   * an Audit runs with the fake payer. The key is used only to sign: it is never printed, stored or committed.
   */
  parentAccount?: string;
  parentKey?: string;
  /** The testnet RPC to send payments through. Defaults to a public one. */
  testnetRpc?: string;
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

  const extrasRaw = raw.requestExtras ?? {};
  if (!isObj(extrasRaw)) bad('"requestExtras" must map model ids or agent names to objects of extra request fields');
  const requestExtras: Record<string, Record<string, unknown>> = {};
  for (const [model, extra] of Object.entries(extrasRaw as Record<string, unknown>)) {
    if (!isObj(extra)) bad(`"requestExtras.${model}" must be an object`);
    for (const k of ["model", "messages"]) if (k in (extra as object)) bad(`"requestExtras.${model}" may not set "${k}"`);
    requestExtras[model] = extra as Record<string, unknown>;
  }

  const opt = (k: "parentAccount" | "parentKey" | "testnetRpc") => {
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
    requestExtras,
    parentAccount: opt("parentAccount"),
    parentKey: opt("parentKey"),
    testnetRpc: opt("testnetRpc"),
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
  return { baseUrl: s.baseUrl, models: s.models, prices: s.prices, spendCapUsd: s.spendCapUsd, requestExtras: s.requestExtras };
}
