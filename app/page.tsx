"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { calculateBalances, summarizeHousehold } from "./lib/expense";
import { createHouseholdKey, mergeRecentHouseholds } from "./lib/household";
import { loadHouseholdSnapshot, PROFILE_STORAGE_KEY, saveHouseholdSnapshot } from "./lib/persistence";
import { initialExpenses, members, type Expense } from "./lib/sampleData";

type Balance = {
  member: string;
  net: number;
};

const createExpenseId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export default function Home() {
  const [expenses, setExpenses] = useState<Expense[]>(initialExpenses);
  const [houseMembers, setHouseMembers] = useState<string[]>(members);
  const [isHydrated, setIsHydrated] = useState(false);
  const [accountName, setAccountName] = useState("Shail");
  const [householdName, setHouseholdName] = useState("The Nest");
  const [recentHouseholds, setRecentHouseholds] = useState<Array<{ accountName: string; householdName: string; key: string }>>([]);
  const [activeHouseholdKey, setActiveHouseholdKey] = useState(() =>
    createHouseholdKey({ userId: "Shail", householdName: "The Nest" }),
  );
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("Food");
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().slice(0, 10));
  const [payer, setPayer] = useState(members[0]);
  const [memberName, setMemberName] = useState("");
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editCategory, setEditCategory] = useState("Food");
  const [editDate, setEditDate] = useState(new Date().toISOString().slice(0, 10));
  const [editPayer, setEditPayer] = useState(members[0]);

  const balances = useMemo<Balance[]>(() => calculateBalances(expenses, houseMembers) as Balance[], [expenses, houseMembers]);

  const total = useMemo(() => expenses.reduce((sum, expense) => sum + expense.amount, 0), [expenses]);
  const householdSummary = useMemo(() => summarizeHousehold(expenses, houseMembers), [expenses, houseMembers]);

  useEffect(() => {
    const hydrate = async () => {
      try {
        const storedProfile = window.localStorage.getItem(PROFILE_STORAGE_KEY);
        const parsedProfile = storedProfile ? (JSON.parse(storedProfile) as { accountName?: string; householdName?: string }) : null;
        const resolvedAccountName = parsedProfile?.accountName?.trim() || "Shail";
        const resolvedHouseholdName = parsedProfile?.householdName?.trim() || "The Nest";
        const nextHouseholdKey = createHouseholdKey({
          userId: resolvedAccountName,
          householdName: resolvedHouseholdName,
        });

        setAccountName(resolvedAccountName);
        setHouseholdName(resolvedHouseholdName);
        setActiveHouseholdKey(nextHouseholdKey);

        const storedRecentHouseholds = window.localStorage.getItem("nestsplit-recent-households");
        if (storedRecentHouseholds) {
          try {
            const parsedRecentHouseholds = JSON.parse(storedRecentHouseholds) as Array<{ accountName: string; householdName: string; key: string }>;
            setRecentHouseholds(parsedRecentHouseholds);
          } catch {
            setRecentHouseholds([]);
          }
        }

        const snapshot = await loadHouseholdSnapshot(members, initialExpenses, nextHouseholdKey);
        setExpenses(snapshot.expenses);
        setHouseMembers(snapshot.members);
        const nextDefaultMember = snapshot.members[0] ?? members[0];
        setPayer(nextDefaultMember);
        setEditPayer(nextDefaultMember);
      } catch {
        const fallbackHouseholdKey = createHouseholdKey({ userId: "Shail", householdName: "The Nest" });
        const snapshot = await loadHouseholdSnapshot(members, initialExpenses, fallbackHouseholdKey);
        setExpenses(snapshot.expenses);
        setHouseMembers(snapshot.members);
        const nextDefaultMember = snapshot.members[0] ?? members[0];
        setPayer(nextDefaultMember);
        setEditPayer(nextDefaultMember);
      } finally {
        setIsHydrated(true);
      }
    };

    void hydrate();
  }, []);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify({ accountName, householdName }));

    const nextRecentHouseholds = mergeRecentHouseholds(recentHouseholds, { accountName, householdName });
    window.localStorage.setItem("nestsplit-recent-households", JSON.stringify(nextRecentHouseholds));

    void saveHouseholdSnapshot(
      {
        expenses,
        members: houseMembers,
        updatedAt: new Date().toISOString(),
      },
      activeHouseholdKey,
    );
  }, [accountName, activeHouseholdKey, expenses, householdName, houseMembers, isHydrated, recentHouseholds]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const parsedAmount = Number(amount);
    if (!title.trim() || !parsedAmount) {
      return;
    }

    setExpenses((current) => [
      ...current,
      {
        id: createExpenseId(),
        title: title.trim(),
        amount: parsedAmount,
        payer,
        participants: houseMembers,
        category: category.trim() || "Other",
        date: expenseDate || new Date().toISOString().slice(0, 10),
      },
    ]);

    setTitle("");
    setAmount("");
    setCategory("Food");
    setExpenseDate(new Date().toISOString().slice(0, 10));
    setPayer(houseMembers[0] ?? members[0]);
  };

  const applyHouseholdSelection = async (nextAccountName: string, nextHouseholdName: string) => {
    const resolvedAccountName = nextAccountName.trim() || "Guest";
    const resolvedHouseholdName = nextHouseholdName.trim() || "Home";
    const nextHouseholdKey = createHouseholdKey({ userId: resolvedAccountName, householdName: resolvedHouseholdName });

    setAccountName(resolvedAccountName);
    setHouseholdName(resolvedHouseholdName);
    setActiveHouseholdKey(nextHouseholdKey);

    window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify({ accountName: resolvedAccountName, householdName: resolvedHouseholdName }));

    const nextRecentHouseholds = mergeRecentHouseholds(recentHouseholds, { accountName: resolvedAccountName, householdName: resolvedHouseholdName });
    const hasChanged = JSON.stringify(nextRecentHouseholds) !== JSON.stringify(recentHouseholds);

    if (hasChanged) {
      setRecentHouseholds(nextRecentHouseholds);
    }

    window.localStorage.setItem("nestsplit-recent-households", JSON.stringify(nextRecentHouseholds));

    const snapshot = await loadHouseholdSnapshot(members, initialExpenses, nextHouseholdKey);
    setExpenses(snapshot.expenses);
    setHouseMembers(snapshot.members);
    const nextDefaultMember = snapshot.members[0] ?? members[0];
    setPayer(nextDefaultMember);
    setEditPayer(nextDefaultMember);
    setIsHydrated(true);
  };

  const handleSwitchHousehold = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await applyHouseholdSelection(accountName, householdName);
  };

  const handleRecentHouseholdSelect = async (entry: { accountName: string; householdName: string; key: string }) => {
    await applyHouseholdSelection(entry.accountName, entry.householdName);
  };

  const handleAddMember = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedName = memberName.trim();
    if (!trimmedName || houseMembers.includes(trimmedName)) {
      return;
    }

    const nextMembers = [...houseMembers, trimmedName];
    setHouseMembers(nextMembers);
    setExpenses((current) =>
      current.map((expense) => ({
        ...expense,
        participants: nextMembers,
        payer: expense.payer === payer ? payer : expense.payer,
      })),
    );
    setMemberName("");
  };

  const handleRemoveMember = (memberToRemove: string) => {
    if (houseMembers.length === 1) {
      return;
    }

    const nextMembers = houseMembers.filter((member) => member !== memberToRemove);
    setHouseMembers(nextMembers);
    setExpenses((current) =>
      current.map((expense) => ({
        ...expense,
        participants: nextMembers,
        payer: expense.payer === memberToRemove ? nextMembers[0] : expense.payer,
      })),
    );
    setPayer((current) => (current === memberToRemove ? nextMembers[0] : current));
    setEditPayer((current) => (current === memberToRemove ? nextMembers[0] : current));
  };

  const handleStartEdit = (expense: Expense) => {
    setEditingExpenseId(expense.id);
    setEditTitle(expense.title);
    setEditAmount(String(expense.amount));
    setEditCategory(expense.category || "Other");
    setEditDate(expense.date || new Date().toISOString().slice(0, 10));
    setEditPayer(expense.payer);
  };

  const handleCancelEdit = () => {
    setEditingExpenseId(null);
    setEditTitle("");
    setEditAmount("");
    setEditCategory("Food");
    setEditDate(new Date().toISOString().slice(0, 10));
    setEditPayer(houseMembers[0] ?? members[0]);
  };

  const handleEditSubmit = (event: React.FormEvent<HTMLFormElement>, expenseId: string) => {
    event.preventDefault();

    const parsedAmount = Number(editAmount);
    if (!editTitle.trim() || !parsedAmount) {
      return;
    }

    setExpenses((current) =>
      current.map((expense) =>
        expense.id === expenseId
          ? {
              ...expense,
              title: editTitle.trim(),
              amount: parsedAmount,
              payer: editPayer,
              category: editCategory.trim() || "Other",
              date: editDate || new Date().toISOString().slice(0, 10),
            }
          : expense,
      ),
    );

    handleCancelEdit();
  };

  const handleDelete = (expenseId: string) => {
    setExpenses((current) => current.filter((expense) => expense.id !== expenseId));
    if (editingExpenseId === expenseId) {
      handleCancelEdit();
    }
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.2),_transparent_45%),linear-gradient(135deg,_#f8fbff_0%,_#eef4ff_100%)] px-4 py-8 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <section className="overflow-hidden rounded-[2rem] border border-slate-200/80 bg-white/80 p-6 shadow-[0_20px_80px_rgba(15,23,42,0.08)] backdrop-blur sm:p-8 lg:p-10">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl space-y-5">
              <span className="inline-flex items-center rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-sm font-medium text-cyan-700">
                NestSplit • Shared home, split simply
              </span>
              <div className="space-y-3">
                <h1 className="text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
                  Track shared expenses without the month-end headache.
                </h1>
                <p className="max-w-xl text-lg leading-8 text-slate-600">
                  Add purchases in seconds, keep everyone in sync, and see who owes what with clean, instant balance updates.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <a
                  href="#dashboard"
                  className="rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-700"
                >
                  Open dashboard
                </a>
                <Link
                  href="/insights"
                  className="rounded-full border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                >
                  View insights
                </Link>
              </div>
              <div className="flex flex-wrap gap-2">
                {houseMembers.map((member) => (
                  <span key={member} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-medium text-slate-700">
                    {member}
                  </span>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-slate-950 p-5 text-white shadow-xl">
              <p className="text-sm uppercase tracking-[0.24em] text-slate-400">This month</p>
              <p className="mt-2 text-3xl font-semibold">₹{total}</p>
              <p className="mt-2 text-sm text-slate-300">Total shared spending across {houseMembers.length} members</p>
            </div>
          </div>
        </section>

        <section className="rounded-[2rem] border border-slate-200/80 bg-white p-6 shadow-[0_20px_80px_rgba(15,23,42,0.06)] sm:p-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Household profile</p>
              <h2 className="text-2xl font-semibold text-slate-900">Switch and save your shared space</h2>
              <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-600">
                Each profile keeps its own expenses, members, and balances so you can manage more than one home from the same app.
              </p>
            </div>
            <form onSubmit={handleSwitchHousehold} className="w-full max-w-2xl space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  value={accountName}
                  onChange={(event) => setAccountName(event.target.value)}
                  placeholder="Your name"
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-0"
                />
                <input
                  value={householdName}
                  onChange={(event) => setHouseholdName(event.target.value)}
                  placeholder="Household name"
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-0"
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-slate-500">Active key: <span className="font-medium text-slate-700">{activeHouseholdKey}</span></p>
                <button
                  type="submit"
                  className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
                >
                  Switch household
                </button>
              </div>
              {recentHouseholds.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {recentHouseholds.map((entry) => (
                    <button
                      key={entry.key}
                      type="button"
                      onClick={() => void handleRecentHouseholdSelect(entry)}
                      className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                    >
                      {entry.accountName} • {entry.householdName}
                    </button>
                  ))}
                </div>
              )}
            </form>
          </div>
        </section>

        <section id="dashboard" className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-[2rem] border border-slate-200/80 bg-white p-6 shadow-[0_20px_80px_rgba(15,23,42,0.06)] sm:p-8">
            <div className="mb-5 grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm text-slate-500">House total</p>
                <p className="mt-1 text-xl font-semibold text-slate-900">₹{total}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm text-slate-500">Avg per person</p>
                <p className="mt-1 text-xl font-semibold text-slate-900">₹{householdSummary.averagePerMember}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm text-slate-500">Highest spend</p>
                <p className="mt-1 text-xl font-semibold text-slate-900">{householdSummary.highestExpense?.title ?? "No entries"}</p>
              </div>
            </div>
            <div className="mb-6 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500">Latest activity</p>
                <h2 className="text-2xl font-semibold text-slate-900">Expense flow</h2>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="mb-5 space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="What did you buy?"
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-0"
                />
                <input
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  type="number"
                  min="0"
                  placeholder="Amount"
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-0"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <select
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none"
                >
                  <option value="Food">Food</option>
                  <option value="Bills">Bills</option>
                  <option value="Utilities">Utilities</option>
                  <option value="Fun">Fun</option>
                  <option value="Other">Other</option>
                </select>
                <input
                  value={expenseDate}
                  onChange={(event) => setExpenseDate(event.target.value)}
                  type="date"
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none"
                />
                <select
                  value={payer}
                  onChange={(event) => setPayer(event.target.value)}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none"
                >
                  {houseMembers.map((member) => (
                    <option key={member} value={member}>
                      {member}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
                >
                  Add expense
                </button>
              </div>
            </form>

            <div className="space-y-3">
              {expenses.map((expense) => {
                const isEditing = editingExpenseId === expense.id;

                return (
                  <div key={expense.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                    {isEditing ? (
                      <form onSubmit={(event) => handleEditSubmit(event, expense.id)} className="space-y-3">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <input
                            value={editTitle}
                            onChange={(event) => setEditTitle(event.target.value)}
                            placeholder="What did you buy?"
                            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-0"
                          />
                          <input
                            value={editAmount}
                            onChange={(event) => setEditAmount(event.target.value)}
                            type="number"
                            min="0"
                            placeholder="Amount"
                            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-0"
                          />
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                          <div className="grid gap-3 sm:grid-cols-3">
                            <select
                              value={editCategory}
                              onChange={(event) => setEditCategory(event.target.value)}
                              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none"
                            >
                              <option value="Food">Food</option>
                              <option value="Bills">Bills</option>
                              <option value="Utilities">Utilities</option>
                              <option value="Fun">Fun</option>
                              <option value="Other">Other</option>
                            </select>
                            <input
                              value={editDate}
                              onChange={(event) => setEditDate(event.target.value)}
                              type="date"
                              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none"
                            />
                            <select
                              value={editPayer}
                              onChange={(event) => setEditPayer(event.target.value)}
                              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none"
                            >
                              {houseMembers.map((member) => (
                                <option key={member} value={member}>
                                  {member}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="submit"
                              className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={handleCancelEdit}
                              className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      </form>
                    ) : (
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="font-semibold text-slate-900">{expense.title}</p>
                          <p className="text-sm text-slate-500">{expense.category || "Other"} • {expense.date || "No date"}</p>
                          <p className="text-sm text-slate-500">Paid by {expense.payer}</p>
                        </div>
                        <div className="text-left sm:text-right">
                          <p className="font-semibold text-slate-900">₹{expense.amount}</p>
                          <p className="text-sm text-slate-500">Split equally</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => handleStartEdit(expense)}
                            className="rounded-full border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(expense.id)}
                            className="rounded-full border border-rose-200 px-3 py-1.5 text-sm font-semibold text-rose-700 transition hover:bg-rose-50"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-[2rem] border border-slate-200/80 bg-slate-950 p-6 text-white shadow-[0_20px_80px_rgba(15,23,42,0.16)] sm:p-8">
            <p className="text-sm font-medium uppercase tracking-[0.24em] text-slate-400">Balances</p>
            <h2 className="mt-2 text-2xl font-semibold">Who owes what</h2>
            <div className="mt-6 space-y-3">
              {balances.map((item) => (
                <div key={item.member} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/10 px-4 py-3">
                  <span className="font-medium">{item.member}</span>
                  <span className={`font-semibold ${item.net < 0 ? "text-rose-300" : "text-emerald-300"}`}>
                    {item.net < 0 ? "Owes" : "Gets"} ₹{Math.abs(item.net)}
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-6 space-y-3 rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-4">
              <div>
                <p className="text-sm font-medium text-cyan-200">Suggested settlement</p>
                <p className="mt-2 text-sm leading-7 text-slate-300">
                  {householdSummary.largestPositiveBalance && householdSummary.largestNegativeBalance
                    ? `${householdSummary.largestPositiveBalance.member} should receive from ${householdSummary.largestNegativeBalance.member}`
                    : "Add a few expenses to see the next best settlement step."}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/20 p-3 text-sm text-slate-200">
                <p className="font-medium">Top payer: {householdSummary.topPayer.member}</p>
                <p className="mt-1 text-slate-300">₹{householdSummary.topPayer.total} contributed so far</p>
              </div>
            </div>
          </div>
        </section>

        <section id="members" className="rounded-[2rem] border border-slate-200/80 bg-white p-6 shadow-[0_20px_80px_rgba(15,23,42,0.06)] sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Members</p>
              <h2 className="text-2xl font-semibold text-slate-900">Household roster</h2>
            </div>
            <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-medium text-slate-700">
              {houseMembers.length} active members
            </div>
          </div>

          <form onSubmit={handleAddMember} className="mt-5 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:flex-row">
            <input
              value={memberName}
              onChange={(event) => setMemberName(event.target.value)}
              placeholder="Add a housemate"
              className="flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-0"
            />
            <button
              type="submit"
              className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
            >
              Add member
            </button>
          </form>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {houseMembers.map((member) => (
              <div key={member} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <span className="font-medium text-slate-900">{member}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveMember(member)}
                  disabled={houseMembers.length === 1}
                  className="rounded-full border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </section>

        <section id="features" className="grid gap-4 md:grid-cols-3">
          {[
            {
              title: "Lightning-fast entry",
              text: "Capture an expense in a few taps with smart defaults and instant split suggestions.",
            },
            {
              title: "Clear household math",
              text: "See totals, contributions, balances, and suggested settlements in one view.",
            },
            {
              title: "Built for real homes",
              text: "Made for shared living, multiple members, and multi-house tenant isolation.",
            },
          ].map((feature: { title: string; text: string }) => (
            <div key={feature.title} className="rounded-[1.5rem] border border-slate-200/80 bg-white/70 p-5 shadow-sm">
              <h3 className="text-lg font-semibold text-slate-900">{feature.title}</h3>
              <p className="mt-2 text-sm leading-7 text-slate-600">{feature.text}</p>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
