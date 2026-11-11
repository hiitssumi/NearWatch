// Reads a contract for a live Audit and refuses anything that is not Rust with near-sdk.

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

export class UnsupportedContract extends Error {}

const USES_NEAR_SDK = /\bnear_sdk\b/;

async function rustFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await rustFiles(p)));
    else if (entry.name.endsWith(".rs")) out.push(p);
  }
  return out.sort();
}

/**
 * Accepts a `.rs` file that uses near_sdk, or a crate folder whose Cargo.toml depends on near-sdk
 * (its `src/**.rs` files are joined, each headed by its path). Anything else is refused with a reason.
 */
export async function readContract(path: string): Promise<string> {
  const refuse = (why: string): never => {
    throw new UnsupportedContract(`NearWatch audits only Rust contracts written with near-sdk. ${path}: ${why}`);
  };
  const info = await stat(path).catch(() => refuse("no such file or folder."));

  if (info.isDirectory()) {
    const cargo = await readFile(join(path, "Cargo.toml"), "utf8").catch(() => refuse("folder has no Cargo.toml."));
    if (!/^\s*near-sdk\s*=/m.test(cargo) && !/\[dependencies\.near-sdk\]/.test(cargo)) {
      refuse("Cargo.toml does not depend on near-sdk.");
    }
    const files = await rustFiles(join(path, "src")).catch(() => [] as string[]);
    if (files.length === 0) refuse("crate has no .rs files under src/.");
    const parts = await Promise.all(files.map(async (f) => `// ---- ${relative(path, f)} ----\n${await readFile(f, "utf8")}`));
    const source = parts.join("\n");
    if (!USES_NEAR_SDK.test(source)) refuse("no source file uses near_sdk.");
    return source;
  }

  if (!path.endsWith(".rs")) refuse("not a Rust source file (.rs) or a crate folder.");
  const source = await readFile(path, "utf8");
  if (!USES_NEAR_SDK.test(source)) refuse("the file does not use near_sdk.");
  return source;
}
