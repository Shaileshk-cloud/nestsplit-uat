"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Expense = { amount: number; date: string; paidBy: string };
type House = { id: string; name: string; members: { id: string; name: string }[]; expenses: Expense[] };

const money = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value || 0);
const demoMonths = [
  { month: "Feb", total: 5649 }, { month: "Mar", total: 6350 }, { month: "Apr", total: 5920 },
  { month: "May", total: 5859 }, { month: "Jun", total: 7020 }, { month: "Jul", total: 8000 },
];

export default function InsightsPage() {
  const [house, setHouse] = useState<House | null>(null);
  useEffect(() => {
    const saved = JSON.parse(localStorage.getItem("nestsplit-houses-v2") || "[]") as House[];
    const session = JSON.parse(localStorage.getItem("nestsplit-session-v2") || "null") as { houseId?: string } | null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHouse(saved.find((entry) => entry.id === session?.houseId) || saved.find((entry) => entry.id === "NS-DEMO26") || null);
  }, []);
  const monthly = useMemo(() => {
    if (!house?.expenses.length) return demoMonths;
    const result = new Map<string, number>();
    house.expenses.forEach((expense) => { const key = expense.date.slice(0, 7); result.set(key, (result.get(key) || 0) + expense.amount); });
    return [...result.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-6).map(([key, total]) => ({ month: new Date(`${key}-01T00:00:00`).toLocaleDateString("en-IN", { month: "short" }), total }));
  }, [house]);
  const contributions = useMemo(() => (house?.members || []).map((member) => ({ name: member.name, total: (house?.expenses || []).filter((expense) => expense.paidBy === member.id).reduce((sum, expense) => sum + expense.amount, 0) })), [house]);
  const comparison = monthly.slice(-2);
  return <main className="insights-page"><div className="insights-shell"><header><Link href="/">‹ Back</Link><p>INSIGHTS</p><h1>Household spending</h1><span>Clear trends, without the clutter.</span></header><section className="chart-panel"><div className="chart-title"><div><small>MONTHLY COMPARISON</small><h2>{comparison[1]?.month || "Current"} vs {comparison[0]?.month || "Previous"}</h2></div><b>{comparison[1] ? money(comparison[1].total) : "—"}</b></div><div className="chart-area"><ResponsiveContainer width="100%" height="100%"><BarChart data={comparison}><CartesianGrid vertical={false} stroke="#e8eee7" /><XAxis dataKey="month" axisLine={false} tickLine={false} /><YAxis hide /><Tooltip formatter={(value) => money(Number(value))} cursor={{ fill: "#f2f7ef" }} /><Bar dataKey="total" fill="#47795a" radius={[9, 9, 2, 2]} /></BarChart></ResponsiveContainer></div></section><section className="chart-panel"><div className="chart-title"><div><small>6-MONTH TREND</small><h2>Shared spending over time</h2></div></div><div className="chart-area"><ResponsiveContainer width="100%" height="100%"><LineChart data={monthly}><CartesianGrid vertical={false} stroke="#e8eee7" /><XAxis dataKey="month" axisLine={false} tickLine={false} /><YAxis hide /><Tooltip formatter={(value) => money(Number(value))} /><Line type="monotone" dataKey="total" stroke="#244c39" strokeWidth={3} dot={{ fill: "#c5f9a9", stroke: "#244c39", strokeWidth: 2, r: 4 }} /></LineChart></ResponsiveContainer></div></section><section className="chart-panel"><div className="chart-title"><div><small>WHO PAID</small><h2>Member contributions</h2></div></div><div className="chart-area"><ResponsiveContainer width="100%" height="100%"><BarChart data={contributions}><CartesianGrid vertical={false} stroke="#e8eee7" /><XAxis dataKey="name" axisLine={false} tickLine={false} /><YAxis hide /><Tooltip formatter={(value) => money(Number(value))} /><Bar dataKey="total" fill="#a4cd8d" radius={[9, 9, 2, 2]} /></BarChart></ResponsiveContainer></div></section></div></main>;
}
