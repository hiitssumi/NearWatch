// The testnet deployment of the vaults: how its two new actions are serialized, and the testnet-only guard.
// The deployment itself runs on a real node in test/deploy.slow.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DeployError, testnetDeployer } from "../src/near/deploy.ts";
import { encodeTransaction } from "../src/near/transaction.ts";

const tx = (actions: Parameters<typeof encodeTransaction>[0]["actions"]) =>
  Buffer.from(encodeTransaction({ signerId: "a", publicKey: new Uint8Array(32), nonce: 0n, receiverId: "b", blockHash: new Uint8Array(32), actions })).toString("hex");
// What every transaction below starts with: signer "a", a zero key, nonce 0, receiver "b", a zero block hash, and one action.
const head = tx([]).slice(0, -8) + "01000000";

test("a contract deployment and a function call are serialized as nearcore's Action enum lays them out", () => {
  // DeployContract is action 1: the code as a length-prefixed byte string.
  assert.equal(tx([{ type: "deployContract", code: Uint8Array.of(0xaa, 0xbb) }]), `${head}01` + "02000000" + "aabb");
  // FunctionCall is action 2: the method name, the args (both length-prefixed), gas as u64, the deposit as u128.
  assert.equal(
    tx([{ type: "functionCall", methodName: "new", args: new TextEncoder().encode("{}"), gas: 30n * 10n ** 12n, deposit: 1n }]),
    `${head}02` + "03000000" + "6e6577" + "02000000" + "7b7d" + "00e057eb481b0000" + "01000000000000000000000000000000",
  );
});

test("the vaults are deployed only under a testnet parent account; with no parent and key there is no deployer", () => {
  assert.equal(testnetDeployer({}), null);
  assert.throws(
    () => testnetDeployer({ parentAccount: "nearwatch.near", parentKey: "ed25519:x" }),
    (e: Error) => e instanceof DeployError && e.message === 'The vaults are deployed on testnet only: "nearwatch.near" is not a testnet account (its name must end in .testnet).',
  );
});
