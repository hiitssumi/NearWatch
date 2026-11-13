// A small NEAR JSON-RPC client: the four calls payments need.

import { base58Decode } from "./keys.ts";

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<Response>;

export class NearRpcError extends Error {
  /** nearcore's name for what went wrong, such as UNKNOWN_ACCOUNT, when it gave one. */
  readonly cause_?: string;
  constructor(message: string, cause?: string) {
    super(message);
    this.cause_ = cause;
  }
}

const TIMEOUT_MS = 60_000;

export class NearRpc {
  readonly url: string;
  private readonly fetch: FetchLike;
  constructor(url: string, fetchFn: FetchLike = (u, i) => fetch(u, i)) {
    this.url = url;
    this.fetch = fetchFn;
  }

  private async call(method: string, params: unknown): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await this.fetch(this.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "nearwatch", method, params }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw new NearRpcError(`could not reach the NEAR RPC at ${this.url}: ${(e as Error).message}`);
    }
    let body: { result?: Record<string, unknown>; error?: { name?: string; cause?: { name?: string; info?: unknown }; message?: string; data?: unknown } };
    try {
      body = (await res.json()) as typeof body;
    } catch {
      throw new NearRpcError(`the NEAR RPC at ${this.url} answered HTTP ${res.status} with no JSON`);
    }
    if (body.error) {
      const cause = body.error.cause?.name;
      // nearcore puts the useful detail in `data` (for a rejected transaction) or in the cause's `info`.
      const parts = [body.error.data, body.error.cause?.info].filter((x) => x !== undefined && x !== null && !(typeof x === "object" && Object.keys(x).length === 0));
      const detail = parts.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ");
      throw new NearRpcError(`${cause ?? body.error.name ?? "RPC error"}: ${body.error.message ?? ""} ${detail}`.trim().slice(0, 400), cause);
    }
    // Older nodes report a failed query inside the result.
    if (typeof body.result?.error === "string") throw new NearRpcError(body.result.error.slice(0, 400), /does not exist/.test(body.result.error) ? "UNKNOWN" : undefined);
    return body.result ?? {};
  }

  /** The network the node is on: "testnet", "mainnet", or a local name. */
  async chainId(): Promise<string> {
    return String((await this.call("status", [])).chain_id);
  }

  // Queries read the latest block, not the last final one: a final block lags a transaction that has just
  // run, so it would show a stale balance and a nonce that has already been used.

  /** An account's balance, or null when the account does not exist. */
  async account(accountId: string): Promise<{ yoctoNear: bigint } | null> {
    try {
      const r = await this.call("query", { request_type: "view_account", finality: "optimistic", account_id: accountId });
      return { yoctoNear: BigInt(String(r.amount)) };
    } catch (e) {
      if (e instanceof NearRpcError && (e.cause_ === "UNKNOWN_ACCOUNT" || e.cause_ === "UNKNOWN")) return null;
      throw e;
    }
  }

  /** The next nonce to use for a key, and a recent block hash to sign against. Null when the account has no such key. */
  async accessKey(accountId: string, publicKeyText: string): Promise<{ nonce: bigint; blockHash: Uint8Array } | null> {
    try {
      const r = await this.call("query", { request_type: "view_access_key", finality: "optimistic", account_id: accountId, public_key: publicKeyText });
      return { nonce: BigInt(String(r.nonce)), blockHash: base58Decode(String(r.block_hash)) };
    } catch (e) {
      if (e instanceof NearRpcError && ["UNKNOWN_ACCESS_KEY", "UNKNOWN_ACCOUNT", "UNKNOWN"].includes(e.cause_ ?? "")) return null;
      throw e;
    }
  }

  /** Sends a signed transaction and waits for it to run. Throws with the chain's reason when it fails. */
  async send(signed: Uint8Array): Promise<void> {
    const r = await this.call("broadcast_tx_commit", [Buffer.from(signed).toString("base64")]);
    const status = r.status as Record<string, unknown> | undefined;
    if (status && "Failure" in status) throw new NearRpcError(`the transaction failed on chain: ${JSON.stringify(status.Failure).slice(0, 400)}`);
  }
}
