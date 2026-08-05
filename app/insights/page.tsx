"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { buildAnalytics, formatCurrency } from "../lib/analytics";
import { initialExpenses, members, type Expense } from "../lib/sampleData";

const formatTooltipValue = (value: number | string | undefined) => {
  if (typeof value === "number") {
    return formatCurrency(value);
  }

  return String(value ?? "");
};

type RangeKey = "3M" | "6M" | "1Y" | "All";

const ranges: RangeKey[] = ["3M", "6M", "1Y", "All"];

const palette = ["#0f766e", "#2563eb", "#8b5cf6", "#f59e0b", "#ef4444"];

function getChartFill(index: number) {
  return palette[index % palette.length];
}

export default function InsightsPage() {
  const [range, setRange] = useState<RangeKey>("6M");
  const [selectedCategory, setSelectedCategory] = useState("Food");

  const analytics = useMemo(() => buildAnalytics(initialExpenses as Expense[], members, range), [range]);

  const categoryTrend = useMemo(() => {
    if (!analytics.categoryOptions.includes(selectedCategory)) {
      return analytics.categoryTrend;
    }

    return analytics.categoryTrend;
  }, [analytics.categoryOptions, analytics.categoryTrend, selectedCategory]);

  const paidVsFairShare = useMemo(() => {
    return analytics.memberSeries.map((memberEntry) => ({
      member: memberEntry.member,
      paid: memberEntry.total,
      fairShare: analytics.fairShareSeries.find((entry) => entry.member === memberEntry.member)?.fairShare || 0,
    }));
  }, [analytics.fairShareSeries, analytics.memberSeries]);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.18),_transparent_40%),linear-gradient(135deg,_#f8fbff_0%,_#eef4ff_100%)] px-4 py-8 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <section className="rounded-[2rem] border border-slate-200/80 bg-white/80 p-6 shadow-[0_20px_80px_rgba(15,23,42,0.08)] backdrop-blur sm:p-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-sm font-medium uppercase tracking-[0.24em] text-cyan-700">Insights & analytics</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
                Understand how your household is spending over time.
              </h1>
              <p className="mt-3 text-sm leading-7 text-slate-600 sm:text-base">
                Review spending trends, category mix, member contributions, and fairness in one polished view built from real expense data.
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 p-1">
              {ranges.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setRange(option)}
                  className={`rounded-full px-3 py-2 text-sm font-semibold transition ${range === option ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-white"}`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Total spend", value: formatCurrency(analytics.totalSpend) },
            { label: "Avg / month", value: formatCurrency(analytics.averageMonthlySpend) },
            { label: "Highest month", value: analytics.highestSpendingMonth ? `${analytics.highestSpendingMonth.month}` : "—" },
            { label: "Lowest month", value: analytics.lowestSpendingMonth ? `${analytics.lowestSpendingMonth.month}` : "—" },
          ].map((item) => (
            <div key={item.label} className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm text-slate-500">{item.label}</p>
              <p className="mt-2 text-xl font-semibold text-slate-900">{item.value}</p>
            </div>
          ))}
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
          <div className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500">Spending trend</p>
                <h2 className="text-xl font-semibold text-slate-900">Monthly spending</h2>
              </div>
              <span className="text-sm text-slate-500">{range} view</span>
            </div>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={analytics.monthlySeries}>
                  <CartesianGrid stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} minTickGap={16} />
                  <YAxis tickLine={false} axisLine={false} tickFormatter={(value) => `₹${value / 1000}k`} />
                  <Tooltip formatter={(value) => formatTooltipValue(value as number | string | undefined)} />
                  <Line type="monotone" dataKey="total" stroke="#0f766e" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500">Insights</p>
                <h2 className="text-xl font-semibold text-slate-900">Calculated highlights</h2>
              </div>
            </div>
            <div className="space-y-3">
              {analytics.insights.map((insight) => (
                <div key={insight} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  {insight}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500">Category spending</p>
                <h2 className="text-xl font-semibold text-slate-900">Where your money went</h2>
              </div>
            </div>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics.categorySeries.slice(0, 6)} layout="vertical" margin={{ top: 8, right: 20, left: 8, bottom: 8 }}>
                  <CartesianGrid stroke="#e2e8f0" horizontal={false} />
                  <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={(value) => `₹${value / 1000}k`} />
                  <YAxis dataKey="category" type="category" tickLine={false} axisLine={false} width={90} />
                  <Tooltip formatter={(value) => formatTooltipValue(value as number | string | undefined)} />
                  <Bar dataKey="total" radius={[0, 8, 8, 0]}>
                    {analytics.categorySeries.slice(0, 6).map((entry, index) => (
                      <Cell key={entry.category} fill={getChartFill(index)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500">Category trend</p>
                <h2 className="text-xl font-semibold text-slate-900">Select a category</h2>
              </div>
              <select
                value={selectedCategory}
                onChange={(event) => setSelectedCategory(event.target.value)}
                className="rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm outline-none"
              >
                {analytics.categoryOptions.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </div>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={categoryTrend}>
                  <CartesianGrid stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} minTickGap={16} />
                  <YAxis tickLine={false} axisLine={false} tickFormatter={(value) => `₹${value / 1000}k`} />
                  <Tooltip formatter={(value) => formatTooltipValue(value as number | string | undefined)} />
                  <Line type="monotone" dataKey="total" stroke="#2563eb" strokeWidth={3} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
          <div className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
            <div className="mb-4">
              <p className="text-sm font-medium text-slate-500">Who paid</p>
              <h2 className="text-xl font-semibold text-slate-900">Member contribution totals</h2>
            </div>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics.memberSeries}>
                  <CartesianGrid stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="member" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} tickFormatter={(value) => `₹${value / 1000}k`} />
                  <Tooltip formatter={(value) => formatTooltipValue(value as number | string | undefined)} />
                  <Bar dataKey="total" radius={[8, 8, 0, 0]} fill="#8b5cf6" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
            <div className="mb-4">
              <p className="text-sm font-medium text-slate-500">Paid vs fair share</p>
              <h2 className="text-xl font-semibold text-slate-900">Who paid more than their share</h2>
            </div>
            <div className="space-y-3">
              {paidVsFairShare.map((item) => {
                const delta = item.paid - item.fairShare;
                return (
                  <div key={item.member} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-slate-900">{item.member}</span>
                      <span className={`text-sm font-semibold ${delta >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                        {delta >= 0 ? `+${formatCurrency(delta)}` : formatCurrency(delta)}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-sm text-slate-600">
                      <span>Paid: {formatCurrency(item.paid)}</span>
                      <span>Fair share: {formatCurrency(item.fairShare)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <div className="mb-4">
            <p className="text-sm font-medium text-slate-500">Top 5 biggest expenses</p>
            <h2 className="text-xl font-semibold text-slate-900">Your biggest transactions</h2>
          </div>
          <div className="space-y-3">
            {analytics.topExpenses.map((expense: Expense & { month: string }) => (
              <div key={expense.id} className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-semibold text-slate-900">{expense.title}</p>
                  <p className="text-sm text-slate-500">{expense.category} • {expense.month}</p>
                </div>
                <div className="text-left sm:text-right">
                  <p className="font-semibold text-slate-900">{formatCurrency(expense.amount)}</p>
                  <p className="text-sm text-slate-500">Paid by {expense.payer}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="flex justify-start">
          <Link href="/" className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100">
            Back to dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
