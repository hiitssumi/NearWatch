// Real payments, as plain NEAR transfers between accounts under the builder's parent account. No contract.
//
//   payer.<parent>   pays the Fee to the parent at the start of an Audit
//   <parent>         pays each agent its Payout at the end, and returns what is left to the payer
//   <agent>.<parent> one account per agent; they only receive
//
// Every sub-account is created with the parent's key, so the one key in settings signs for the parent and for
// the payer. The key is used only to sign: it is never logged and never put in an error.

import type { AgentName } from "../domain.ts";
import { type Payer, PaymentError, type PayoutOrder } from "../ports.ts";
import { AGENT_NAMES, type Settings } from "../settings.ts";
import { parseSecretKey, type SigningKey } from "./keys.ts";
import { NearRpc, NearRpcError } from "./rpc.ts";
import { type Action, signTransaction } from "./transaction.ts";

const NEAR = 10n ** 24n;
/** What a new agent account starts with: enough to exist (storage), nothing more. */
export const AGENT_START_YOCTO = NEAR / 100n;
/** The payer account is kept at this by the setup command, and topped up when it falls below one Fee and a margin. */
export const PAYER_TARGET_YOCTO = (NEAR * 3n) / 2n;
export const PAYER_LOW_YOCTO = (NEAR * 11n) / 10n;
/** Kept back from a balance for gas when checking that a transfer can be afforded. */
const GAS_MARGIN_YOCTO = NEAR / 100n;

export const DEFAULT_TESTNET_RPC = "https://rpc.testnet.fastnear.com";
export const TESTNET_EXPLORER_TX = "https://testnet.nearblocks.io/txns/";

const near = (yocto: bigint) => {
  const frac = (yocto % NEAR).toString().padStart(24, "0").replace(/0+$/, "");
  return `${yocto / NEAR}${frac ? `.${frac}` : ""} NEAR`;
};

export interface NearPaymentsOptions {
  rpc: NearRpc;
  parentAccount: string;
  key: SigningKey;
  /** The only network payments may be sent on. Checked against the node before the first transaction. */
  network: string;
}

export class NearPayments implements Payer {
  readonly describe: string;
  readonly explorer?: string;
  private readonly rpc: NearRpc;
  private readonly parent: string;
  private readonly key: SigningKey;
  private readonly network: string;
  private networkChecked = false;
  /** The last nonce used for each signer, so two transactions in a row never reuse one. */
  private readonly lastNonce = new Map<string, bigint>();

  constructor(o: NearPaymentsOptions) {
    this.rpc = o.rpc;
    this.parent = o.parentAccount;
    this.key = o.key;
    this.network = o.network;
    if (o.network === "testnet") this.explorer = TESTNET_EXPLORER_TX;
    this.describe = `${o.network} payer (real transfers: the Fee from ${this.accountOf("payer")} to ${this.parent}, Payouts from ${this.parent})`;
  }

  accountOf(who: AgentName | "payer"): string {
    return `${who}.${this.parent}`;
  }

  /** Refuses to send anything unless the node is on the one network this payer was made for. */
  private async checkNetwork(): Promise<void> {
    if (this.networkChecked) return;
    let chain: string;
    try {
      chain = await this.rpc.chainId();
    } catch (e) {
      throw new PaymentError((e as Error).message);
    }
    if (chain !== this.network) {
      throw new PaymentError(`Payments are sent on ${this.network} only, but the RPC at ${this.rpc.url} is on "${chain}". Nothing was sent.`);
    }
    this.networkChecked = true;
  }

  /** Signs and sends one transaction from `signerId`, which must hold this payer's key. Returns its hash. */
  private async transact(signerId: string, receiverId: string, actions: Action[]): Promise<string> {
    await this.checkNetwork();
    try {
      const access = await this.rpc.accessKey(signerId, this.key.publicKeyText);
      if (!access) {
        throw new PaymentError(`${signerId} does not exist or does not hold the parent key (${this.key.publicKeyText}). Run: npm run setup-accounts`);
      }
      const used = this.lastNonce.get(signerId) ?? 0n;
      const nonce = (access.nonce > used ? access.nonce : used) + 1n;
      const { hash, signed } = signTransaction({ signerId, publicKey: this.key.publicKey, nonce, receiverId, blockHash: access.blockHash, actions }, this.key);
      this.lastNonce.set(signerId, nonce);
      await this.rpc.send(signed);
      return hash;
    } catch (e) {
      if (e instanceof PaymentError) throw e;
      if (e instanceof NearRpcError) throw new PaymentError(e.message);
      throw e;
    }
  }

  private async balance(accountId: string): Promise<bigint | null> {
    try {
      return (await this.rpc.account(accountId))?.yoctoNear ?? null;
    } catch (e) {
      throw new PaymentError((e as Error).message);
    }
  }

  async collectFee(yoctoNear: string): Promise<{ hash: string }> {
    await this.checkNetwork();
    const payer = this.accountOf("payer");
    const fee = BigInt(yoctoNear);
    const held = await this.balance(payer);
    if (held === null) throw new PaymentError(`The payer account ${payer} does not exist. Run: npm run setup-accounts`);
    if (held < fee + GAS_MARGIN_YOCTO) {
      throw new PaymentError(`The payer account ${payer} holds ${near(held)}, not enough for the ${near(fee)} Fee and gas. Run: npm run setup-accounts`);
    }
    return { hash: await this.transact(payer, this.parent, [{ type: "transfer", yoctoNear: fee }]) };
  }

  async send(order: PayoutOrder): Promise<{ hash: string }> {
    return { hash: await this.transact(this.parent, this.accountOf(order.agent), [{ type: "transfer", yoctoNear: BigInt(order.yoctoNear) }]) };
  }

  /**
   * Creates the payer's account and one account per agent under the parent, each holding the parent's key,
   * and brings the payer's balance up to its target. Safe to run again: what exists is left alone.
   */
  async setup(log: (line: string) => void): Promise<void> {
    await this.checkNetwork();
    const parentHeld = await this.balance(this.parent);
    if (parentHeld === null) throw new PaymentError(`The parent account ${this.parent} does not exist on ${this.network}.`);
    if (!(await this.rpc.accessKey(this.parent, this.key.publicKeyText))) {
      throw new PaymentError(`The key in settings (${this.key.publicKeyText}) is not a key of ${this.parent}.`);
    }
    log(`Parent ${this.parent}: ${near(parentHeld)}`);

    for (const who of [...AGENT_NAMES, "payer"] as const) {
      const account = this.accountOf(who);
      const target = who === "payer" ? PAYER_TARGET_YOCTO : AGENT_START_YOCTO;
      const held = await this.balance(account);
      if (held === null) {
        const hash = await this.transact(this.parent, account, [
          { type: "createAccount" },
          { type: "transfer", yoctoNear: target },
          { type: "addFullAccessKey", publicKey: this.key.publicKey },
        ]);
        log(`  ${account}: created with ${near(target)} [${hash}]`);
      } else if (who === "payer" && held < PAYER_LOW_YOCTO) {
        const hash = await this.transact(this.parent, account, [{ type: "transfer", yoctoNear: PAYER_TARGET_YOCTO - held }]);
        log(`  ${account}: held ${near(held)}, topped up to ${near(PAYER_TARGET_YOCTO)} [${hash}]`);
      } else {
        log(`  ${account}: already exists with ${near(held)}, left alone`);
      }
    }
  }
}

/**
 * The testnet payer, from settings: the only way the commands make a real payer. It refuses a parent account
 * that is not a testnet account, and (before its first transaction) an RPC that is not on testnet.
 * Null when settings name no parent account and key.
 */
export function testnetPayer(settings: Pick<Settings, "parentAccount" | "parentKey" | "testnetRpc">): NearPayments | null {
  if (!settings.parentAccount && !settings.parentKey) return null;
  if (!settings.parentAccount || !settings.parentKey) {
    throw new PaymentError('Settings must give both "parentAccount" and "parentKey" for real Payouts, or neither to run without them.');
  }
  if (!/^[a-z0-9_-]+(\.[a-z0-9_-]+)*\.testnet$/.test(settings.parentAccount)) {
    throw new PaymentError(`Payments are sent on testnet only: "${settings.parentAccount}" is not a testnet account (its name must end in .testnet).`);
  }
  return new NearPayments({
    rpc: new NearRpc(settings.testnetRpc ?? DEFAULT_TESTNET_RPC),
    parentAccount: settings.parentAccount,
    key: parseSecretKey(settings.parentKey, '"parentKey" in settings'),
    network: "testnet",
  });
}
