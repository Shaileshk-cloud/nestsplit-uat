import { describe, it, expect } from "vitest";
import { minimalTransfers, type NetBalance } from "./settle";

const sumIn = (ts: { paise: bigint }[]) => ts.reduce((s, t) => s + t.paise, 0n);

describe("minimalTransfers", () => {
  it("returns no transfers when everyone is square", () => {
    const nets: NetBalance[] = [
      { memberId: "a", paise: 0n },
      { memberId: "b", paise: 0n },
    ];
    expect(minimalTransfers(nets)).toEqual([]);
  });

  it("settles one creditor against two debtors", () => {
    // A is owed 600; B and C each owe 300.
    const nets: NetBalance[] = [
      { memberId: "a", paise: 600n },
      { memberId: "b", paise: -300n },
      { memberId: "c", paise: -300n },
    ];
    const transfers = minimalTransfers(nets);
    // Everyone pays into A; total moved equals the outstanding debt.
    expect(transfers.every((t) => t.to === "a")).toBe(true);
    expect(sumIn(transfers)).toBe(600n);
    expect(transfers.length).toBeLessThanOrEqual(nets.length - 1);
  });

  it("produces a deterministic, conserving set of transfers", () => {
    const nets: NetBalance[] = [
      { memberId: "a", paise: 500n },
      { memberId: "b", paise: 200n },
      { memberId: "c", paise: -700n },
    ];
    const transfers = minimalTransfers(nets);
    // C owes 700 total, split toward the two creditors largest-first.
    expect(transfers).toEqual([
      { from: "c", to: "a", paise: 500n },
      { from: "c", to: "b", paise: 200n },
    ]);
    expect(sumIn(transfers)).toBe(700n);
  });

  it("never creates a transfer larger than the debt or credit", () => {
    const nets: NetBalance[] = [
      { memberId: "a", paise: 100n },
      { memberId: "b", paise: 150n },
      { memberId: "c", paise: -250n },
    ];
    const transfers = minimalTransfers(nets);
    expect(sumIn(transfers)).toBe(250n);
    for (const t of transfers) expect(t.paise).toBeGreaterThan(0n);
  });
});
