// Tiny validators for agents' structured answers. Each one returns the typed value or throws
// an InvalidAnswer naming the path that was wrong, so the message can be shown to the agent on retry.

export class InvalidAnswer extends Error {}

export type Check<T> = (value: unknown, path: string) => T;

const fail = (path: string, wanted: string, value: unknown): never => {
  throw new InvalidAnswer(`${path || "answer"}: expected ${wanted}, got ${JSON.stringify(value)?.slice(0, 80)}`);
};

export const str: Check<string> = (v, p) => (typeof v === "string" && v.length > 0 ? v : fail(p, "a non-empty string", v));

export const bool: Check<boolean> = (v, p) => (typeof v === "boolean" ? v : fail(p, "true or false", v));

/** A decimal integer written as a string, as NEAR amounts are. */
export const amount: Check<string> = (v, p) => (typeof v === "string" && /^\d+$/.test(v) ? v : fail(p, "a decimal integer string", v));

export const oneOf =
  <const T extends string>(...options: T[]): Check<T> =>
  (v, p) =>
    options.includes(v as T) ? (v as T) : fail(p, `one of ${options.join(", ")}`, v);

export const array =
  <T>(item: Check<T>, { min = 0 } = {}): Check<T[]> =>
  (v, p) => {
    if (!Array.isArray(v)) return fail(p, "an array", v);
    if (v.length < min) return fail(p, `at least ${min} item(s)`, v);
    return v.map((x, i) => item(x, `${p}[${i}]`));
  };

export const record =
  <T>(item: Check<T>): Check<Record<string, T>> =>
  (v, p) => {
    if (typeof v !== "object" || v === null || Array.isArray(v)) return fail(p, "an object", v);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, item(x, `${p}.${k}`)]));
  };

export const anyObject: Check<Record<string, unknown>> = record((x) => x);

export const object =
  <S extends Record<string, Check<unknown>>>(shape: S): Check<{ [K in keyof S]: ReturnType<S[K]> }> =>
  (v, p) => {
    if (typeof v !== "object" || v === null || Array.isArray(v)) return fail(p, "an object", v);
    const o = v as Record<string, unknown>;
    return Object.fromEntries(Object.entries(shape).map(([k, c]) => [k, c(o[k], p ? `${p}.${k}` : k)])) as {
      [K in keyof S]: ReturnType<S[K]>;
    };
  };

/** Picks the first shape whose discriminating key is present. */
export const variant =
  <T>(cases: Record<string, Check<T>>): Check<T> =>
  (v, p) => {
    if (typeof v === "object" && v !== null) {
      for (const [key, check] of Object.entries(cases)) if (key in v) return check(v, p);
    }
    return fail(p, `an object with one of: ${Object.keys(cases).join(", ")}`, v);
  };

/** Parses an LLM answer as JSON, tolerating a ```json fence around it. */
export function parseJson(text: string): unknown {
  const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(text);
  try {
    return JSON.parse(fenced ? fenced[1]! : text);
  } catch (e) {
    throw new InvalidAnswer(`answer is not valid JSON: ${(e as Error).message}`);
  }
}
