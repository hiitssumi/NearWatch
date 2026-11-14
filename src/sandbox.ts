// The toolchain's "run a Scenario" operation, against a local NEAR sandbox.
//
// The work is done by the fixed Rust harness in `rust/harness` (one JSON request on stdin, one JSON
// line on stdout). It is compiled once per process; each contract crate is built to wasm once per
// process with cargo-near. The harness only ever starts a local sandbox node of its own.

import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { RuleCheck, SandboxSetup, Scenario, ScenarioOutcome } from "./domain.ts";
import { scenarioOutcome } from "./schemas.ts";

const run = promisify(execFile);

export const RUST_DIR = resolve(import.meta.dirname, "..", "rust");
const HARNESS_BIN = join(RUST_DIR, "target", "release", "nearwatch-harness");

/**
 * The defaults suit the demo vaults: the contract is deployed to "vault", "owner" is created with
 * 100 NEAR and calls `new({owner})`. The Attacker's prompt names these accounts.
 */
export const VAULT_SETUP: SandboxSetup = {
  contract: "vault",
  accounts: { owner: "100000000000000000000000000" },
  init: { as: "owner", method: "new", args: { owner: "owner" } },
};

/** The harness refused the request ("invalid": the message names the problem) or failed ("internal"). */
export class SandboxError extends Error {
  readonly kind: "invalid" | "internal";
  constructor(kind: "invalid" | "internal", message: string) {
    super(message);
    this.kind = kind;
  }
}

/** Cargo lives in ~/.cargo/bin after a rustup install, which is not always on PATH. */
function cargoEnv(): NodeJS.ProcessEnv {
  const cargoBin = join(homedir(), ".cargo", "bin");
  return { ...process.env, PATH: `${cargoBin}:${process.env.PATH ?? ""}` };
}

export function findCargo(): boolean {
  return existsSync(join(homedir(), ".cargo", "bin", "cargo")) ||
    (process.env.PATH ?? "").split(":").some((d) => existsSync(join(d, "cargo")));
}

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

/** The crate folder for a contract path: the folder itself, or the nearest parent with a Cargo.toml. */
async function crateDir(contractPath: string): Promise<string> {
  let dir = resolve(contractPath);
  if (!(await stat(dir)).isDirectory()) dir = dirname(dir);
  for (;;) {
    if (existsSync(join(dir, "Cargo.toml"))) return dir;
    const up = dirname(dir);
    if (up === dir) throw new SandboxError("invalid", `no Cargo.toml at or above ${contractPath}`);
    dir = up;
  }
}

// Shared by every LocalSandbox in this process, so nothing is compiled twice.
let harnessBuild: Promise<string> | undefined;
const wasmBuilds = new Map<string, Promise<string>>();
export const buildCounts = { harness: 0, contracts: 0 };

function buildHarness(): Promise<string> {
  harnessBuild ??= (async () => {
    buildCounts.harness++;
    await run("cargo", ["build", "--release", "--quiet", "-p", "nearwatch-harness"], {
      cwd: RUST_DIR,
      env: cargoEnv(),
      maxBuffer: 64 * 1024 * 1024,
    }).catch((e: { stderr?: string; message: string }) => {
      harnessBuild = undefined;
      throw new SandboxError("internal", `building the sandbox harness failed: ${e.stderr || e.message}`);
    });
    return HARNESS_BIN;
  })();
  return harnessBuild;
}

/** Builds the crate holding `contractPath` to wasm (once per process) and gives the wasm file's path. */
export function buildContract(contractPath: string): Promise<string> {
  return crateDir(contractPath).then((dir) => {
    let build = wasmBuilds.get(dir);
    if (!build) {
      build = (async () => {
        buildCounts.contracts++;
        const out = await run("cargo", ["near", "build", "non-reproducible-wasm"], {
          cwd: dir,
          env: cargoEnv(),
          maxBuffer: 64 * 1024 * 1024,
        }).catch((e: { stderr?: string; message: string }) => {
          wasmBuilds.delete(dir);
          throw new SandboxError("internal", `cargo near build in ${dir} failed: ${stripAnsi(e.stderr || e.message)}`);
        });
        const wasm = /Binary:\s*(\S+\.wasm)/.exec(stripAnsi(out.stderr + out.stdout))?.[1];
        if (!wasm) throw new SandboxError("internal", `cargo near build in ${dir} did not report a wasm file`);
        return wasm;
      })();
      wasmBuilds.set(dir, build);
    }
    return build;
  });
}

function callHarness(bin: string, request: unknown): Promise<string> {
  return new Promise((ok, fail) => {
    const child = spawn(bin, [], { cwd: RUST_DIR, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => fail(new SandboxError("internal", `could not start the harness: ${e.message}`)));
    child.on("close", () => {
      const line = stdout.trim().split("\n").at(-1);
      if (line) ok(line);
      else fail(new SandboxError("internal", `the harness printed nothing. stderr: ${stderr.slice(-2000)}`));
    });
    child.stdin.end(JSON.stringify(request));
  });
}

export class LocalSandbox {
  private readonly setup: SandboxSetup;
  constructor(setup: SandboxSetup = VAULT_SETUP) {
    this.setup = setup;
  }

  async runScenario(contractPath: string, scenario: Scenario, check: RuleCheck): Promise<ScenarioOutcome> {
    const [bin, wasm] = await Promise.all([buildHarness(), buildContract(contractPath)]);
    const line = await callHarness(bin, { wasm, setup: this.setup, scenario, check });
    let reply: { ok?: boolean; outcome?: unknown; kind?: "invalid" | "internal"; error?: string };
    try {
      reply = JSON.parse(line);
    } catch {
      throw new SandboxError("internal", `the harness printed something that is not JSON: ${line.slice(0, 500)}`);
    }
    if (!reply.ok) throw new SandboxError(reply.kind ?? "internal", reply.error ?? "the harness failed without a reason");
    return scenarioOutcome(reply.outcome, "outcome");
  }
}
