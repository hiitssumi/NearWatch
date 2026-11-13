// NEAR keys and base58, with Node's own ed25519: no packages. A secret key's text is never put in an error.

import { createPrivateKey, createPublicKey, type KeyObject, sign } from "node:crypto";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}

export function base58Decode(text: string): Uint8Array {
  let n = 0n;
  for (const ch of text) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error("not base58");
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  for (const ch of text) {
    if (ch !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

export class KeyError extends Error {}

/** An ed25519 key that can sign. */
export interface SigningKey {
  /** The 32-byte public key. */
  publicKey: Uint8Array;
  /** "ed25519:<base58>", as NEAR writes public keys. */
  publicKeyText: string;
  sign(message: Uint8Array): Uint8Array;
}

// The fixed DER wrappers for a raw ed25519 seed (PKCS#8) and a raw public key (SPKI).
const PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");
const SPKI = Buffer.from("302a300506032b6570032100", "hex");

/**
 * Reads a NEAR secret key: "ed25519:" followed by base58 of the 32-byte seed, or of the seed and the public
 * key (64 bytes), which is how NEAR tools write it. `what` names the key in errors; its text never appears.
 */
export function parseSecretKey(text: string, what: string): SigningKey {
  const [curve, body, ...rest] = text.trim().split(":");
  if (curve !== "ed25519" || !body || rest.length > 0) throw new KeyError(`${what} must look like "ed25519:<base58 text>"`);
  let raw: Uint8Array;
  try {
    raw = base58Decode(body);
  } catch {
    throw new KeyError(`${what} is not valid base58 after "ed25519:"`);
  }
  if (raw.length !== 32 && raw.length !== 64) throw new KeyError(`${what} must hold 32 or 64 bytes, not ${raw.length}`);
  let secret: KeyObject;
  try {
    secret = createPrivateKey({ key: Buffer.concat([PKCS8, raw.subarray(0, 32)]), format: "der", type: "pkcs8" });
  } catch {
    throw new KeyError(`${what} is not a usable ed25519 key`);
  }
  const publicKey = new Uint8Array(createPublicKey(secret).export({ format: "der", type: "spki" }).subarray(SPKI.length));
  if (raw.length === 64 && !Buffer.from(raw.subarray(32)).equals(Buffer.from(publicKey))) {
    throw new KeyError(`${what} is damaged: its public half does not match its secret half`);
  }
  return {
    publicKey,
    publicKeyText: `ed25519:${base58Encode(publicKey)}`,
    sign: (message) => new Uint8Array(sign(null, message, secret)),
  };
}
