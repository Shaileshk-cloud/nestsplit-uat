// ---------------------------------------------------------------------------
// House balance calculation — pure, integer-paise, and deactivation-safe.
//
// Sign convention:
//   positive balance → this member is owed money ("you get back")
//   negative balance → this member owes money ("you owe")
//
// For each expense:
//   payer.balance += expense.amount            (they fronted the cash)
//   each split member.balance -= split.amount  (they owe their share)
// For each settlement:
//   from_member.balance += amount              (they paid down what they owed)
//   to_member.balance   -= amount              (they received what they were owed)
//
// Correctness: we seed a running total for EVERY member id that appears in any
// expense, split, or settlement — not just the currently-active ones. If a
// member is deactivated while still carrying (or being owed) money, dropping
// their entry would silently break the zero-sum invariant for everyone else.
// Seeding every referenced id guarantees sum(balances) === 0.
//
// Legacy fallback: expenses with no recorded splits (pre-`expense_splits` data)
// are divided equally across the currently-active members, last member
// absorbing the paise remainder.
// ---------------------------------------------------------------------------

/** Minimal shape of a member needed to compute balances. */
export type BalanceMember = { id: string; active: boolean };
/** Minimal shape of an expense: total + payer + recorded splits. */
export type BalanceExpense = {
  amount: number;
  paid_by: string;
  splits: { member_id: string; amount: number }[];
};
/** Minimal shape of a settlement transfer between two members. */
export type BalanceSettlement = {
  from_member_id: string;
  to_member_id: string;
  amount: number;
};

/** Round a rupee amount to integer paise as a bigint. */
function toPaise(value: number): bigint {
  return BigInt(Math.round(Number(value) * 100));
}

function bump(totals: Map<string, bigint>, id: string, deltaPaise: bigint): void {
  totals.set(id, (totals.get(id) ?? 0n) + deltaPaise);
}

/**
 * Compute each member's net balance (in rupees) from expenses + settlements.
 * Returns the input members enriched with a `balance` field, in input order.
 * Members that never appear in any expense/split/settlement get balance 0.
 */
export function calcBalances<M extends BalanceMember>(
  members: M[],
  expenses: BalanceExpense[],
  settlements: BalanceSettlement[],
): (M & { balance: number })[] {
  const totals = new Map<string, bigint>();
  const ensure = (id: string) => { if (!totals.has(id)) totals.set(id, 0n); };

  // Seed every id we know about (members + every id referenced by data).
  members.forEach((m) => ensure(m.id));
  expenses.forEach((e) => {
    ensure(e.paid_by);
    e.splits.forEach((s) => ensure(s.member_id));
  });
  settlements.forEach((s) => { ensure(s.from_member_id); ensure(s.to_member_id); });

  const activeIds = members.filter((m) => m.active).map((m) => m.id);

  expenses.forEach((e) => {
    const amountPaise = toPaise(e.amount);
    // Credit the payer the full amount.
    bump(totals, e.paid_by, amountPaise);

    if (e.splits.length > 0) {
      // Debit each participant their recorded share.
      e.splits.forEach((s) => bump(totals, s.member_id, -toPaise(s.amount)));
    } else if (activeIds.length > 0) {
      // Legacy fallback: equal share across active members; last absorbs remainder.
      const n = BigInt(activeIds.length);
      const share = amountPaise / n;
      const remainder = amountPaise - share * n;
      activeIds.forEach((id, idx) => {
        bump(totals, id, -(idx === activeIds.length - 1 ? share + remainder : share));
      });
    }
  });

  settlements.forEach((s) => {
    const amt = toPaise(s.amount);
    bump(totals, s.from_member_id, amt);
    bump(totals, s.to_member_id, -amt);
  });

  return members.map((m) => ({ ...m, balance: Number(totals.get(m.id) ?? 0n) / 100 }));
}
