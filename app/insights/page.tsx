"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Bar, BarChart, CartesianGrid, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { getSupabaseBrowserClient } from "@/app/lib/supabase";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Transaction = {
  id: string;
  transaction_kind: "income" | "expense";
  amount: number;
  category: string;
  description: string;
  transaction_date: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const money = (value: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value || 0);

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function InsightsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!client) { setAuthError("Supabase is not configured."); setLoading(false); return; }

    void (async () => {
      const { data: sessionData } = await client.auth.getSession();
      const user = sessionData.session?.user ?? null;
      if (!user) { setAuthError("Sign in to view your insights."); setLoading(false); return; }

      const { data, error } = await client
        .from("personal_transactions")
        .select("id,transaction_kind,amount,category,description,transaction_date")
        .eq("user_id", user.id)
        .eq("transaction_kind", "expense")
        .order("transaction_date", { ascending: false });

      if (error) { setAuthError(error.message); } else { setTransactions((data || []) as Transaction[]); }
      setLoading(false);
    })();
  }, []);

  // ── 6-month monthly totals ──
  const monthly = useMemo(() => {
    const map = new Map<string, number>();
    transactions.forEach((t) => {
      const key = t.transaction_date.slice(0, 7);
      map.set(key, (map.get(key) ?? 0) + Number(t.amount));
    });
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([key, total]) => ({
        month: new Date(`${key}-01T00:00:00`).toLocaleDateString("en-IN", { month: "short" }),
        total,
      }));
  }, [transactions]);

  // ── Category breakdown (all time) ──
  const categories = useMemo(() => {
    const map: Record<string, number> = {};
    transactions.forEach((t) => { map[t.category] = (map[t.category] ?? 0) + Number(t.amount); });
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .map(([name, total]) => ({ name, total }));
  }, [transactions]);

  // ── Current vs previous month comparison ──
  const comparison = monthly.slice(-2);

  // ── This month stats ──
  const thisMonthKey = new Date().toISOString().slice(0, 7);
  const thisMonthTotal = useMemo(
    () => transactions.filter((t) => t.transaction_date.slice(0, 7) === thisMonthKey).reduce((s, t) => s + Number(t.amount), 0),
    [transactions, thisMonthKey],
  );
  const thisMonthCount = useMemo(
    () => transactions.filter((t) => t.transaction_date.slice(0, 7) === thisMonthKey).length,
    [transactions, thisMonthKey],
  );

  return (
    <main className="insights-page">
      <div className="insights-shell">
        <header>
          <Link href="/">‹ Back</Link>
          <p>PERSONAL INSIGHTS</p>
          <h1>Your spending</h1>
          <span>
            {loading ? "Loading…" : authError ? authError : `${thisMonthCount} expense${thisMonthCount !== 1 ? "s" : ""} this month · ${money(thisMonthTotal)}`}
          </span>
        </header>

        {!loading && authError && (
          <section className="chart-panel">
            <p style={{ padding: "20px 0", color: "var(--muted)", fontSize: 13 }}>{authError}</p>
          </section>
        )}

        {!loading && !authError && (
          <>
            {/* Monthly comparison */}
            <section className="chart-panel">
              <div className="chart-title">
                <div>
                  <small>MONTHLY COMPARISON</small>
                  <h2>{comparison[1]?.month || "Current"} vs {comparison[0]?.month || "Previous"}</h2>
                </div>
                <b>{comparison[1] ? money(comparison[1].total) : "—"}</b>
              </div>
              <div className="chart-area">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={comparison}>
                    <CartesianGrid vertical={false} stroke="#e8eee7" />
                    <XAxis dataKey="month" axisLine={false} tickLine={false} />
                    <YAxis hide />
                    <Tooltip formatter={(value) => money(Number(value))} cursor={{ fill: "#f2f7ef" }} />
                    <Bar dataKey="total" fill="#47795a" radius={[9, 9, 2, 2]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            {/* 6-month trend */}
            <section className="chart-panel">
              <div className="chart-title">
                <div>
                  <small>6-MONTH TREND</small>
                  <h2>Personal spending over time</h2>
                </div>
              </div>
              <div className="chart-area">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={monthly}>
                    <CartesianGrid vertical={false} stroke="#e8eee7" />
                    <XAxis dataKey="month" axisLine={false} tickLine={false} />
                    <YAxis hide />
                    <Tooltip formatter={(value) => money(Number(value))} />
                    <Line
                      type="monotone"
                      dataKey="total"
                      stroke="#244c39"
                      strokeWidth={3}
                      dot={{ fill: "#c5f9a9", stroke: "#244c39", strokeWidth: 2, r: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>

            {/* Category breakdown */}
            {categories.length > 0 && (
              <section className="chart-panel">
                <div className="chart-title">
                  <div>
                    <small>BY CATEGORY</small>
                    <h2>Where your money goes</h2>
                  </div>
                  <b>{categories[0]?.name ?? ""}</b>
                </div>
                <div className="chart-area">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={categories}>
                      <CartesianGrid vertical={false} stroke="#e8eee7" />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} />
                      <YAxis hide />
                      <Tooltip formatter={(value) => money(Number(value))} />
                      <Bar dataKey="total" fill="#a4cd8d" radius={[9, 9, 2, 2]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>
            )}

            {transactions.length === 0 && (
              <section className="chart-panel">
                <p style={{ padding: "30px 0", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
                  Add your first expense to see charts here.
                </p>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
