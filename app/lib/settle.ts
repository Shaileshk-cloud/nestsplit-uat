// ---------------------------------------------------------------------------
// Settle-up optimizer — turn per-member net balances into a small set of
// concrete "A pays B ₹X" transfers.
//
// All math is in integer paise (bigint). Input nets MUST sum to zero (they
// come from calcBalances, which guarantees this). Sign convention matches
// calcBalances: positive = creditor (is owed), negative = debtor (owes).
//
// Algorithm: greedily match the largest remaining creditor with the largest
// remaining debtor, transferring min(credit, debt), until everyone nets zero.
// This yields at most n-1 transfers. (Finding the provably minimum number of
// transfers is NP-hard; this greedy result is small and always correct, which
// is the standard approach for expense-splitting apps.) Ties are broken by
// memberId so the output is deterministic and unit-testable.
// ---------------------------------------------------------------------------

/** A member's net position in paise. Positive = owed money; negative = owes. */
export type NetBalance = { memberId: string; paise: bigint };

/** A concrete suggested payment: `from` pays `to` `paise`. */
export type Transfer = { from: string; to: string; paise: bigint };

type Bucket = { id: string; amt: bigint };

// Sort by amount descending, then memberId ascending — fully deterministic.
function byAmountDescThenId(a: Bucket, b: Bucket): number {
  if (a.amt > b.amt) return -1;
  if (a.amt < b.amt) return 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Compute a minimal-ish set of transfers that settles all balances.
 * Returns an empty array when everyone is already square.
 */
export function minimalTransfers(nets: NetBalance[]): Transfer[] {
  const creditors: Bucket[] = nets
    .filter((n) => n.paise > 0n)
    .map((n) => ({ id: n.memberId, amt: n.paise }))
    .sort(byAmountDescThenId);
  const debtors: Bucket[] = nets
    .filter((n) => n.paise < 0n)
    .map((n) => ({ id: n.memberId, amt: -n.paise }))
    .sort(byAmountDescThenId);

  const transfers: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < creditors.length && j < debtors.length) {
    const credit = creditors[i];
    const debt = debtors[j];
    const t = credit.amt < debt.amt ? credit.amt : debt.amt;
    if (t > 0n) transfers.push({ from: debt.id, to: credit.id, paise: t });
    credit.amt -= t;
    debt.amt -= t;
    if (credit.amt === 0n) i++;
    if (debt.amt === 0n) j++;
  }
  return transfers;
}
