export type Expense = {
  id: string;
  title: string;
  amount: number;
  payer: string;
  participants: string[];
  category: string;
  date: string;
};

export const members = ["Shail", "Arun", "Kiran"];

export const initialExpenses: Expense[] = [
  { id: "expense-groceries", title: "Groceries", amount: 1200, payer: "Shail", participants: members, category: "Food", date: "2026-08-01" },
  { id: "expense-milk", title: "Milk & eggs", amount: 260, payer: "Arun", participants: members, category: "Food", date: "2026-08-02" },
  { id: "expense-utilities", title: "Utilities", amount: 480, payer: "Kiran", participants: members, category: "Bills", date: "2026-08-03" },
];
