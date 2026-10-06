import { describe, it, expect } from "vitest";
import { calcBalances, type BalanceMember, type BalanceExpense, type BalanceSettlement } from "./balances";

type M = BalanceMember & { name: string };

const sum = (bs: { balance: number }[]) => bs.reduce((s, b) => s + b.balance, 0);

describe("calcBalances", () => {
  it("splits an equal expense so balances sum to zero", () => {
    const members: M[] = [
      { id: "a", name: "A", active: true },
      { id: "b", name: "B", active: true },
      { id: "c", name: "C", active: true },
    ];
    const expenses: BalanceExpense[] = [
      { amount: 900, paid_by: "a", splits: [
        { member_id: "a", amount: 300 },
        { member_id: "b", amount: 300 },
        { member_id: "c", amount: 300 },
      ] },
    ];
    const out = calcBalances(members, expenses, []);
    expect(out.find((m) => m.id === "a")!.balance).toBe(600);
    expect(out.find((m) => m.id === "b")!.balance).toBe(-300);
    expect(out.find((m) => m.id === "c")!.balance).toBe(-300);
    expect(sum(out)).toBe(0);
  });

  it("REGRESSION (finding #1): keeps balances zero-sum when the payer is deactivated", () => {
    // C fronted the cash but was later removed from the house. Their +600
    // credit must not vanish, or A and B would appear to owe money into thin air.
    const members: M[] = [
      { id: "a", name: "A", active: true },
      { id: "b", name: "B", active: true },
      { id: "c", name: "C (removed)", active: false },
    ];
    const expenses: BalanceExpense[] = [
      { amount: 900, paid_by: "c", splits: [
        { member_id: "a", amount: 300 },
        { member_id: "b", amount: 300 },
        { member_id: "c", amount: 300 },
      ] },
    ];
    const out = calcBalances(members, expenses, []);
    expect(out.find((m) => m.id === "c")!.balance).toBe(600);
    expect(out.find((m) => m.id === "a")!.balance).toBe(-300);
    expect(out.find((m) => m.id === "b")!.balance).toBe(-300);
    expect(sum(out)).toBe(0);
  });

  it("keeps a deactivated participant's debit, not just the payer's credit", () => {
    const members: M[] = [
      { id: "a", name: "A", active: true },
      { id: "b", name: "B (removed)", active: false },
    ];
    const expenses: BalanceExpense[] = [
      { amount: 500, paid_by: "a", splits: [
        { member_id: "a", amount: 250 },
        { member_id: "b", amount: 250 },
      ] },
    ];
    const out = calcBalances(members, expenses, []);
    expect(out.find((m) => m.id === "a")!.balance).toBe(250);
    expect(out.find((m) => m.id === "b")!.balance).toBe(-250);
    expect(sum(out)).toBe(0);
  });

  it("applies settlements: paying down a debt moves both sides toward zero", () => {
    const members: M[] = [
      { id: "a", name: "A", active: true },
      { id: "b", name: "B", active: true },
    ];
    const expenses: BalanceExpense[] = [
      { amount: 100, paid_by: "a", splits: [
        { member_id: "a", amount: 50 },
        { member_id: "b", amount: 50 },
      ] },
    ];
    // Before settlement: A +50, B -50. B pays A 50 → both 0.
    const settlements: BalanceSettlement[] = [
      { from_member_id: "b", to_member_id: "a", amount: 50 },
    ];
    const out = calcBalances(members, expenses, settlements);
    expect(out.find((m) => m.id === "a")!.balance).toBe(0);
    expect(out.find((m) => m.id === "b")!.balance).toBe(0);
  });

  it("legacy expenses with no splits fall back to an equal active-member share", () => {
    const members: M[] = [
      { id: "a", name: "A", active: true },
      { id: "b", name: "B", active: true },
      { id: "c", name: "C", active: true },
    ];
    const expenses: BalanceExpense[] = [{ amount: 100, paid_by: "a", splits: [] }];
    const out = calcBalances(members, expenses, []);
    // A: +100 - 33.34 = 66.66 ; B/C: -33.33 each ; remainder on last.
    expect(sum(out)).toBeCloseTo(0, 10);
    expect(out.find((m) => m.id === "a")!.balance).toBeGreaterThan(0);
  });

  it("handles paise rounding without drift (₹10 across 3)", () => {
    const members: M[] = [
      { id: "a", name: "A", active: true },
      { id: "b", name: "B", active: true },
      { id: "c", name: "C", active: true },
    ];
    const expenses: BalanceExpense[] = [
      { amount: 10, paid_by: "a", splits: [
        { member_id: "a", amount: 3.33 },
        { member_id: "b", amount: 3.33 },
        { member_id: "c", amount: 3.34 },
      ] },
    ];
    const out = calcBalances(members, expenses, []);
    expect(sum(out)).toBe(0);
  });
});
