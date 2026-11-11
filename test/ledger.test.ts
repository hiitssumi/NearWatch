// The Ledger's unit cases: pure arithmetic, no Audit.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentName, Verdict } from "../src/domain.ts";
import { FEE_YOCTO, formatNear, ledger } from "../src/ledger.ts";

const ALL = new Set<AgentName>(["scout", "rules", "attacker", "prover", "referee", "reporter"]);
const sum = (ps: { yoctoNear: string }[]) => ps.reduce((s, p) => s + BigInt(p.yoctoNear), 0n);
const to = (ps: { to: string; yoctoNear: string }[], who: string) => sum(ps.filter((p) => p.to === who));
const NEAR = (s: string) => {
  const [w, f = ""] = s.split(".");
  return BigInt(w!) * FEE_YOCTO + BigInt(f.padEnd(24, "0"));
};

const VERDICT_SETS: Record<string, Verdict>[] = [
  {},
  { R1: "Broken" },
  { R1: "Proven", R2: "Proven" },
  { R1: "Broken", R2: "Proven", R3: "Unproven" },
  { R1: "Unproven", R2: "Unproven", R3: "Unproven", R4: "Broken", R5: "Proven", R6: "Broken", R7: "Proven" },
];

test("the Payouts sum to the Fee exactly, whatever the verdicts and Rule count", () => {
  for (const verdicts of VERDICT_SETS) {
    assert.equal(sum(ledger({ verdicts, ran: ALL })), FEE_YOCTO, JSON.stringify(verdicts));
    assert.equal(sum(ledger({ verdicts, ran: new Set(["scout"]) })), FEE_YOCTO);
  }
  // A Fee and Rule count that do not divide evenly: the remainder goes back to the payer.
  const odd = ledger({ verdicts: { R1: "Broken", R2: "Broken", R3: "Broken" }, ran: ALL, fee: 1001n });
  assert.equal(sum(odd), 1001n);
  assert.ok(odd.every((p) => BigInt(p.yoctoNear) >= 0n));
});

test("the Referee's Payout is the same whatever the verdicts", () => {
  for (const verdicts of VERDICT_SETS) {
    assert.equal(to(ledger({ verdicts, ran: ALL }), "referee"), NEAR("0.2"));
  }
});

test("flat shares: Scout 5%, Rules agent 10%, Reporter 5%, Referee 20%", () => {
  const ps = ledger({ verdicts: { R1: "Broken" }, ran: ALL });
  assert.equal(to(ps, "scout"), NEAR("0.05"));
  assert.equal(to(ps, "rules"), NEAR("0.1"));
  assert.equal(to(ps, "reporter"), NEAR("0.05"));
  assert.equal(to(ps, "referee"), NEAR("0.2"));
});

test("each Rule's share of the 60% goes to the Attacker if Broken, the Prover if Proven", () => {
  const ps = ledger({ verdicts: { R1: "Broken", R2: "Proven", R3: "Proven" }, ran: ALL });
  assert.equal(to(ps, "attacker"), NEAR("0.2"));
  assert.equal(to(ps, "prover"), NEAR("0.4"));
  assert.equal(to(ps, "payer"), 0n);
});

test("an Unproven Rule's share returns to the payer", () => {
  const ps = ledger({ verdicts: { R1: "Broken", R2: "Unproven" }, ran: ALL });
  assert.equal(to(ps, "attacker"), NEAR("0.3"));
  assert.equal(to(ps, "payer"), NEAR("0.3"));
  assert.ok(ps.some((p) => p.to === "payer" && p.reason.includes("R2 Unproven")));
});

test("the share of an agent that did not run returns to the payer", () => {
  const ran = new Set<AgentName>(["scout", "rules", "attacker", "referee"]);
  const ps = ledger({ verdicts: { R1: "Broken", R2: "Proven" }, ran });
  assert.equal(to(ps, "reporter"), 0n);
  assert.equal(to(ps, "prover"), 0n);
  // Reporter's 5% plus R2's 30%, which a Prover that never ran cannot have earned.
  assert.equal(to(ps, "payer"), NEAR("0.35"));
  assert.ok(ps.some((p) => p.to === "payer" && p.reason.includes("reporter did not run")));
});

test("no Rules: the whole 60% pool returns to the payer", () => {
  const ps = ledger({ verdicts: {}, ran: ALL });
  assert.equal(to(ps, "payer"), NEAR("0.6"));
});

test("formatNear prints yoctoNEAR as NEAR", () => {
  assert.equal(formatNear(FEE_YOCTO.toString()), "1 NEAR");
  assert.equal(formatNear("50000000000000000000000"), "0.05 NEAR");
  assert.equal(formatNear("1"), "0.000000000000000000000001 NEAR");
});
