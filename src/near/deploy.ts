// The two demo vaults, deployed to NEAR testnet so anyone can look at them on an explorer, and the planted
// bug shown there with real calls. Audits do not use these deployments: the Attacker still runs every Scenario
// in a local sandbox.
//
//   buggy-vault.<parent>  the vault with the planted bug
//   fixed-vault.<parent>  the same vault, which restores a balance when its transfer fails
//
// Each vault account is created with the parent's key and the parent as the vault's owner. The demonstration
// deposits from the parent, then withdraws to a receiver that does not exist, so the vault's transfer fails.

import { createHash } from "node:crypto";
import { base58Encode, parseSecretKey, type SigningKey } from "./keys.ts";
import { DEFAULT_TESTNET_RPC, isTestnetAccount } from "./payments.ts";
import { NearRpc } from "./rpc.ts";
import { type Action, signTransaction } from "./transaction.ts";

const NEAR = 10n ** 24n;
const TGAS = 10n ** 12n;
/** What a vault account starts with: storage for about 120 KB of contract code (1.2 NEAR) and a margin. */
export const VAULT_START_YOCTO = (NEAR * 3n) / 2n;
/** The demonstration's deposit and withdrawal. */
export const DEMO_AMOUNT_YOCTO = NEAR / 10n;
/** A receiver the demonstration withdraws to. It must not exist, so the vault's transfer to it fails. */
export const MISSING_RECEIVER = "no-such-account";

export const VAULTS = ["buggy", "fixed"] as const;
export type VaultName = (typeof VAULTS)[number];

export const TESTNET_EXPLORER_ACCOUNT = "https://testnet.nearblocks.io/address/";

export class DeployError extends Error {}

/** What the demonstration did on chain and what the vault's ledger said before and after the withdrawal. */
export interface Demonstration {
  vault: VaultName;
  account: string;
  depositHash: string;
  withdrawHash: string;
  receiver: string;
  /** The depositor's recorded balance in the vault, in yoctoNEAR, after the deposit and after the failed withdrawal. */
  ledgerBefore: string;
  ledgerAfter: string;
  /** True when the vault's transfer to the missing receiver failed on chain, as it should. */
  transferFailed: boolean;
  /** True when the failed withdrawal took the amount off the ledger anyway: the planted bug. */
  balanceLost: boolean;
}

export interface VaultDeployerOptions {
  rpc: NearRpc;
  parentAccount: string;
  key: SigningKey;
  /** The only network to deploy on. Checked against the node before the first transaction. */
  network: string;
}

export class VaultDeployer {
  private readonly rpc: NearRpc;
  readonly parent: string;
  private readonly key: SigningKey;
  private readonly network: string;
  private networkChecked = false;
  private readonly lastNonce = new Map<string, bigint>();

  constructor(o: VaultDeployerOptions) {
    this.rpc = o.rpc;
    this.parent = o.parentAccount;
    this.key = o.key;
    this.network = o.network;
  }

  accountOf(vault: VaultName): string {
    return `${vault}-vault.${this.parent}`;
  }

  get receiver(): string {
    return `${MISSING_RECEIVER}.${this.parent}`;
  }

  private async checkNetwork(): Promise<void> {
    if (this.networkChecked) return;
    const chain = await this.rpc.chainId();
    if (chain !== this.network) throw new DeployError(`The vaults are deployed on ${this.network} only, but the RPC at ${this.rpc.url} is on "${chain}". Nothing was sent.`);
    this.networkChecked = true;
  }

  /** Signs one transaction from `signerId` (which holds the parent key) and waits for every receipt it caused. */
  private async transact(signerId: string, receiverId: string, actions: Action[]) {
    await this.checkNetwork();
    const access = await this.rpc.accessKey(signerId, this.key.publicKeyText);
    if (!access) throw new DeployError(`${signerId} does not exist or does not hold the parent key (${this.key.publicKeyText}).`);
    const used = this.lastNonce.get(signerId) ?? 0n;
    const nonce = (access.nonce > used ? access.nonce : used) + 1n;
    const { hash, signed } = signTransaction({ signerId, publicKey: this.key.publicKey, nonce, receiverId, blockHash: access.blockHash, actions }, this.key);
    this.lastNonce.set(signerId, nonce);
    return { hash, ...(await this.rpc.execute(signed)) };
  }

  private call(method: string, args: unknown, gas: bigint, deposit = 0n): Action {
    return { type: "functionCall", methodName: method, args: new TextEncoder().encode(JSON.stringify(args)), gas, deposit };
  }

  /**
   * Puts `wasm` on the vault's account: creates the account and initializes the vault the first time, and
   * replaces the code when it has changed. Gives the transaction's hash, or null when the code was already there.
   */
  async deploy(vault: VaultName, wasm: Uint8Array): Promise<{ account: string; hash: string | null; action: "created" | "updated" | "unchanged" }> {
    await this.checkNetwork();
    const account = this.accountOf(vault);
    const existing = await this.rpc.account(account);
    const codeHash = base58Encode(createHash("sha256").update(wasm).digest());
    if (existing?.codeHash === codeHash) return { account, hash: null, action: "unchanged" };
    const actions: Action[] = existing
      ? [{ type: "deployContract", code: wasm }]
      : [
          { type: "createAccount" },
          { type: "transfer", yoctoNear: VAULT_START_YOCTO },
          { type: "addFullAccessKey", publicKey: this.key.publicKey },
          { type: "deployContract", code: wasm },
          this.call("new", { owner: this.parent }, 30n * TGAS),
        ];
    // An existing account signs its own code update; a new one is created by the parent.
    const r = await this.transact(existing ? account : this.parent, account, actions);
    if (r.failure) throw new DeployError(`Deploying the ${vault} vault to ${account} failed on chain: ${r.failure} [${r.hash}]`);
    return { account, hash: r.hash, action: existing ? "updated" : "created" };
  }

  /**
   * The parent's recorded balance in the vault, as of the last block that `tx` or one of its receipts ran in.
   * Retries while the node answering has not seen that block yet.
   */
  private async ledgerAfter(account: string, tx: { blocks: string[] }): Promise<bigint> {
    for (let attempt = 1; ; attempt++) {
      try {
        const height = Math.max(...(await Promise.all(tx.blocks.map((b) => this.rpc.blockHeight(b)))));
        return BigInt(String(await this.rpc.view(account, "balance_of", { account_id: this.parent }, height)));
      } catch (e) {
        if (attempt >= 10) throw e;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  /** Deposits into the vault from the parent, then withdraws the same amount to a receiver that does not exist. */
  async demonstrate(vault: VaultName): Promise<Demonstration> {
    await this.checkNetwork();
    const account = this.accountOf(vault);
    if (await this.rpc.account(this.receiver)) throw new DeployError(`${this.receiver} exists, so a transfer to it would not fail. The demonstration needs a receiver that does not exist.`);
    const deposit = await this.transact(this.parent, account, [this.call("deposit", {}, 30n * TGAS, DEMO_AMOUNT_YOCTO)]);
    if (deposit.failure) throw new DeployError(`The deposit into ${account} failed on chain: ${deposit.failure} [${deposit.hash}]`);
    const before = await this.ledgerAfter(account, deposit);
    const withdraw = await this.transact(this.parent, account, [this.call("withdraw", { amount: DEMO_AMOUNT_YOCTO.toString(), receiver_id: this.receiver }, 100n * TGAS)]);
    const after = await this.ledgerAfter(account, withdraw);
    return {
      vault,
      account,
      depositHash: deposit.hash,
      withdrawHash: withdraw.hash,
      receiver: this.receiver,
      ledgerBefore: before.toString(),
      ledgerAfter: after.toString(),
      transferFailed: withdraw.receiptFailures.some((f) => f.includes("AccountDoesNotExist")),
      balanceLost: after === before - DEMO_AMOUNT_YOCTO,
    };
  }
}

/** The testnet deployer, from settings. Refuses a parent that is not a testnet account. Null without a parent and key. */
export function testnetDeployer(settings: { parentAccount?: string; parentKey?: string; testnetRpc?: string }): VaultDeployer | null {
  if (!settings.parentAccount || !settings.parentKey) return null;
  if (!isTestnetAccount(settings.parentAccount)) throw new DeployError(`The vaults are deployed on testnet only: "${settings.parentAccount}" is not a testnet account (its name must end in .testnet).`);
  return new VaultDeployer({
    rpc: new NearRpc(settings.testnetRpc ?? DEFAULT_TESTNET_RPC),
    parentAccount: settings.parentAccount,
    key: parseSecretKey(settings.parentKey, '"parentKey" in settings'),
    network: "testnet",
  });
}
