// The Ledger: pure arithmetic from verdicts to Payouts. It sends nothing; the Audit runner sends.

import type { AgentName, Payout, Verdict } from "./domain.ts";

export type { Payout };

/** 1 NEAR in yoctoNEAR. */
export const FEE_YOCTO = 10n ** 24n;

/** Flat shares, in percent of the Fee. The rest is the Rules pool. */
const FLAT: { agent: AgentName; percent: bigint }[] = [
  { agent: "scout", percent: 5n },
  { agent: "rules", percent: 10n },
  { agent: "reporter", percent: 5n },
  { agent: "referee", percent: 20n },
];
const RULES_POOL_PERCENT = 60n;

export interface LedgerInput {
  /** Verdict per Rule id, in the order the Rules were written. */
  verdicts: Record<string, Verdict>;
  /** The agents that ran in this Audit. */
  ran: ReadonlySet<AgentName>;
  fee?: bigint;
}

/**
 * Splits the Fee into Payouts. Every share whose agent did not run, every Unproven Rule's share and
 * any rounding remainder go back to the payer, so the Payouts always sum to the Fee exactly.
 */
export function ledger({ verdicts, ran, fee = FEE_YOCTO }: LedgerInput): Payout[] {
  const payouts: Payout[] = [];
  const pay = (to: Payout["to"], amount: bigint, reason: string) =>
    payouts.push({ to, yoctoNear: amount.toString(), reason });

  for (const { agent, percent } of FLAT) {
    const amount = (fee * percent) / 100n;
    if (ran.has(agent)) pay(agent, amount, `${percent}% flat share`);
    else pay("payer", amount, `${agent} did not run, its ${percent}% share returned`);
  }

  const pool = (fee * RULES_POOL_PERCENT) / 100n;
  const ruleIds = Object.keys(verdicts);
  if (ruleIds.length === 0) {
    pay("payer", pool, "no Rules, the 60% Rules pool returned");
  } else {
    const share = pool / BigInt(ruleIds.length);
    for (const id of ruleIds) {
      const verdict = verdicts[id]!;
      const to: AgentName | null = verdict === "Broken" ? "attacker" : verdict === "Proven" ? "prover" : null;
      if (to === null) pay("payer", share, `${id} Unproven, its share returned`);
      else if (!ran.has(to)) pay("payer", share, `${id} ${verdict} but ${to} did not run, its share returned`);
      else pay(to, share, `${id} ${verdict}`);
    }
    const remainder = pool - share * BigInt(ruleIds.length);
    if (remainder > 0n) pay("payer", remainder, "rounding remainder of the Rules pool returned");
  }

  // Flat shares divide 10^24 exactly; this catches any other Fee that does not.
  const total = payouts.reduce((s, p) => s + BigInt(p.yoctoNear), 0n);
  if (total < fee) pay("payer", fee - total, "rounding remainder returned");
  return payouts;
}

/** yoctoNEAR as a NEAR amount for the transcript, e.g. "0.2 NEAR". */
export function formatNear(yocto: string): string {
  const n = BigInt(yocto);
  const whole = n / FEE_YOCTO;
  const frac = (n % FEE_YOCTO).toString().padStart(24, "0").replace(/0+$/, "");
  return `${whole}${frac ? `.${frac}` : ""} NEAR`;
}
