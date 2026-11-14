// NEAR transactions, serialized (Borsh) and signed by hand: only the actions payments and the testnet
// deployment of the vaults need.

import { createHash } from "node:crypto";
import { base58Encode, type SigningKey } from "./keys.ts";

export type Action =
  | { type: "createAccount" }
  /** Puts `code` (a wasm file) on the receiver account as its contract. */
  | { type: "deployContract"; code: Uint8Array }
  /** Calls `methodName` on the receiver's contract with `args` (JSON bytes), `gas` and an attached `deposit`. */
  | { type: "functionCall"; methodName: string; args: Uint8Array; gas: bigint; deposit: bigint }
  | { type: "transfer"; yoctoNear: bigint }
  /** Gives `publicKey` full access to the receiver account. */
  | { type: "addFullAccessKey"; publicKey: Uint8Array };

export interface Transaction {
  signerId: string;
  /** The signer's public key (32 bytes). */
  publicKey: Uint8Array;
  nonce: bigint;
  receiverId: string;
  /** A recent block's hash (32 bytes). */
  blockHash: Uint8Array;
  actions: Action[];
}

const u8 = (n: number) => Uint8Array.of(n);
const le = (n: bigint, bytes: number) => {
  const out = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) out[i] = Number((n >> BigInt(8 * i)) & 0xffn);
  return out;
};
const bytes = (b: Uint8Array) => [le(BigInt(b.length), 4), b];
const text = (s: string) => bytes(new TextEncoder().encode(s));
const ed25519Key = (key: Uint8Array) => {
  if (key.length !== 32) throw new Error("a public key must be 32 bytes");
  return [u8(0), key];
};

// The numbers are each action's place in nearcore's Action enum.
function action(a: Action): Uint8Array[] {
  if (a.type === "createAccount") return [u8(0)];
  if (a.type === "deployContract") return [u8(1), ...bytes(a.code)];
  if (a.type === "functionCall") return [u8(2), ...text(a.methodName), ...bytes(a.args), le(a.gas, 8), le(a.deposit, 16)];
  if (a.type === "transfer") return [u8(3), le(a.yoctoNear, 16)];
  // AddKey: the key, then an access key with nonce 0 and the FullAccess permission (1).
  return [u8(5), ...ed25519Key(a.publicKey), le(0n, 8), u8(1)];
}

export function encodeTransaction(tx: Transaction): Uint8Array {
  if (tx.blockHash.length !== 32) throw new Error("a block hash must be 32 bytes");
  return Buffer.concat([
    ...text(tx.signerId),
    ...ed25519Key(tx.publicKey),
    le(tx.nonce, 8),
    ...text(tx.receiverId),
    tx.blockHash,
    le(BigInt(tx.actions.length), 4),
    ...tx.actions.flatMap(action),
  ]);
}

/** Signs a transaction. `hash` is the transaction hash an explorer shows; `signed` is what the RPC accepts. */
export function signTransaction(tx: Transaction, key: SigningKey): { hash: string; signed: Uint8Array } {
  const encoded = encodeTransaction(tx);
  const digest = createHash("sha256").update(encoded).digest();
  const signature = key.sign(digest);
  return { hash: base58Encode(digest), signed: Buffer.concat([encoded, u8(0), signature]) };
}
