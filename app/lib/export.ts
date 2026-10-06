// ---------------------------------------------------------------------------
// CSV export — pure, dependency-free, client-side only.
//
// `toCsv` serializes a 2-D array of cells to an RFC-4180 CSV string (CRLF line
// endings, quote-escaped cells). The domain builders below turn NestSplit's
// house-expense and personal-transaction shapes into labelled tables. All of
// this is pure and unit-tested; `downloadCsv` is the only browser-only bit and
// is a no-op during SSR so it's safe to import anywhere.
//
// Amounts are exported as plain fixed-2 numbers (no "₹" glyph) so spreadsheets
// treat them as numeric. A UTF-8 BOM is prepended at download time so Excel
// renders non-ASCII names correctly.
// ---------------------------------------------------------------------------

export type Cell = string | number | null | undefined;

/** Escape one cell per RFC 4180: wrap in quotes if it contains "," CR LF or a quote. */
function escapeCell(value: Cell): string {
  const s = value == null ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Serialize rows of cells into a CSV string with CRLF line endings. */
export function toCsv(rows: Cell[][]): string {
  return rows.map((row) => row.map(escapeCell).join(",")).join("\r\n");
}

// ── Domain builders ────────────────────────────────────────────────────────

/** House expense with participant names already resolved by the caller. */
export type ExportExpense = {
  expense_date: string;
  title: string;
  category: string;
  amount: number;
  paid_by_name: string;
  splits: { name: string; amount: number }[];
};

/** Build a CSV table (with header) for a house's expenses. */
export function houseExpensesToCsv(expenses: ExportExpense[]): string {
  const header: Cell[] = ["Date", "Title", "Category", "Amount", "Paid by", "Split"];
  const rows: Cell[][] = expenses.map((e) => [
    e.expense_date,
    e.title,
    e.category,
    e.amount.toFixed(2),
    e.paid_by_name,
    e.splits.map((s) => `${s.name}: ${s.amount.toFixed(2)}`).join("; "),
  ]);
  return toCsv([header, ...rows]);
}

/** Personal transaction as loaded from personal_transactions. */
export type ExportTransaction = {
  transaction_date: string;
  transaction_kind: "income" | "expense";
  description: string;
  category: string;
  amount: number;
  notes: string | null;
};

/** Build a CSV table (with header) for personal transactions. */
export function personalTransactionsToCsv(txns: ExportTransaction[]): string {
  const header: Cell[] = ["Date", "Type", "Description", "Category", "Amount", "Notes"];
  const rows: Cell[][] = txns.map((t) => [
    t.transaction_date,
    t.transaction_kind === "income" ? "Income" : "Expense",
    t.description,
    t.category,
    t.amount.toFixed(2),
    t.notes ?? "",
  ]);
  return toCsv([header, ...rows]);
}

// ── Browser download ────────────────────────────────────────────────────────

/**
 * Trigger a client-side CSV download. No-op during SSR. Prepends a UTF-8 BOM
 * so Excel opens the file as UTF-8 (member names, ₹ in notes, etc.).
 */
export function downloadCsv(filename: string, csv: string): void {
  if (typeof document === "undefined") return;
  const bom = String.fromCharCode(0xfeff); // UTF-8 BOM for Excel
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/** Build a safe, dated filename like `nestsplit-expenses-2026-08-21.csv`. */
export function csvFilename(prefix: string, dateStr: string): string {
  const safe = prefix.replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return `${safe || "nestsplit"}-${dateStr}.csv`;
}
