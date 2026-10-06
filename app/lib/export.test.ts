import { describe, it, expect } from "vitest";
import {
  toCsv,
  houseExpensesToCsv,
  personalTransactionsToCsv,
  csvFilename,
  type ExportExpense,
  type ExportTransaction,
} from "./export";

describe("toCsv", () => {
  it("joins cells with commas and rows with CRLF", () => {
    expect(toCsv([["a", "b"], ["c", "d"]])).toBe("a,b\r\nc,d");
  });

  it("quotes and escapes cells containing comma, quote, or newline", () => {
    expect(toCsv([["a,b"]])).toBe('"a,b"');
    expect(toCsv([['he said "hi"']])).toBe('"he said ""hi"""');
    expect(toCsv([["line1\nline2"]])).toBe('"line1\nline2"');
  });

  it("renders null/undefined/number cells", () => {
    expect(toCsv([[null, undefined, 42]])).toBe(",,42");
  });

  it("returns an empty string for no rows", () => {
    expect(toCsv([])).toBe("");
  });
});

describe("houseExpensesToCsv", () => {
  const expenses: ExportExpense[] = [
    {
      expense_date: "2026-08-20",
      title: "Dinner, deluxe",
      category: "Food",
      amount: 1200,
      paid_by_name: "Asha",
      splits: [
        { name: "Asha", amount: 600 },
        { name: "Ravi", amount: 600 },
      ],
    },
  ];

  it("emits a header row plus one row per expense", () => {
    const lines = houseExpensesToCsv(expenses).split("\r\n");
    expect(lines[0]).toBe("Date,Title,Category,Amount,Paid by,Split");
    // Title has a comma → quoted; split column packs "name: amount" pairs.
    expect(lines[1]).toBe('2026-08-20,"Dinner, deluxe",Food,1200.00,Asha,Asha: 600.00; Ravi: 600.00');
  });

  it("emits just the header for no expenses", () => {
    expect(houseExpensesToCsv([])).toBe("Date,Title,Category,Amount,Paid by,Split");
  });
});

describe("personalTransactionsToCsv", () => {
  const txns: ExportTransaction[] = [
    {
      transaction_date: "2026-08-19",
      transaction_kind: "expense",
      description: "Groceries",
      category: "Food",
      amount: 450.5,
      notes: null,
    },
    {
      transaction_date: "2026-08-18",
      transaction_kind: "income",
      description: "Salary",
      category: "Other",
      amount: 50000,
      notes: "monthly",
    },
  ];

  it("maps kind to a readable label and blanks null notes", () => {
    const lines = personalTransactionsToCsv(txns).split("\r\n");
    expect(lines[0]).toBe("Date,Type,Description,Category,Amount,Notes");
    expect(lines[1]).toBe("2026-08-19,Expense,Groceries,Food,450.50,");
    expect(lines[2]).toBe("2026-08-18,Income,Salary,Other,50000.00,monthly");
  });
});

describe("csvFilename", () => {
  it("slugifies the prefix and appends the date", () => {
    expect(csvFilename("NestSplit Expenses", "2026-08-21")).toBe("nestsplit-expenses-2026-08-21.csv");
  });

  it("falls back to nestsplit when the prefix has no safe chars", () => {
    expect(csvFilename("!!!", "2026-08-21")).toBe("nestsplit-2026-08-21.csv");
  });
});
