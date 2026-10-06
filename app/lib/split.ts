// ---------------------------------------------------------------------------
// Split math — all arithmetic in integer paise (1 INR = 100 paise) to avoid
// floating-point drift. These helpers mirror the server-side logic in the
// add_house_expense_v2 RPC; the last participant always absorbs any rounding
// remainder so the parts sum exactly to the total.
//
// Extracted from HouseSmartSplit so both the UI and the unit tests share one
// source of truth.
// ---------------------------------------------------------------------------

/** Round a string/number rupee amount to integer paise. */
export function toPaise(v: number | string): number {
  return Math.round(Number(v) * 100);
}

/** Convert paise back to a fixed-2 display string like "666.67". */
export function fromPaise(p: number): string {
  return (p / 100).toFixed(2);
}

/**
 * Equal split of `amountPaise` across `n` participants.
 * The last participant absorbs the rounding remainder.
 */
export function equalSplitPaise(amountPaise: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(amountPaise / n);
  const remainder = amountPaise - base * n;
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? base + remainder : base));
}

/**
 * Weighted split of `amountPaise` by unitless share weights `ws`.
 * The last participant absorbs the remainder. Non-positive total → all zeros.
 */
export function shareSplitPaise(amountPaise: number, ws: number[]): number[] {
  const total = ws.reduce((s, w) => s + w, 0);
  if (total <= 0) return ws.map(() => 0);
  let allocated = 0;
  return ws.map((w, i) => {
    if (i === ws.length - 1) return amountPaise - allocated;
    const share = Math.floor((amountPaise * w) / total);
    allocated += share;
    return share;
  });
}

/**
 * Percentage split of `amountPaise` by `pcts` (each 0–100).
 * The last participant absorbs the remainder.
 */
export function percentSplitPaise(amountPaise: number, pcts: number[]): number[] {
  let allocated = 0;
  return pcts.map((p, i) => {
    if (i === pcts.length - 1) return amountPaise - allocated;
    const share = Math.floor((amountPaise * p) / 100);
    allocated += share;
    return share;
  });
}
