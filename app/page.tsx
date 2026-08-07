"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient, signInWithGoogle } from "@/app/lib/supabase";
import AppSplash from "@/app/components/AppSplash";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------
type House = { id: string; name: string; house_code: string };
type Workspace = "personal" | "selector" | `house:${string}`;

// ---------------------------------------------------------------------------
// Personal types
// ---------------------------------------------------------------------------
type PersonalTransaction = {
  id: string;
  transaction_kind: "income" | "expense";
  amount: number;
  category: string;
  description: string;
  notes: string | null;
  transaction_date: string;
};
type MoneyItem = {
  id: string;
  direction: "give" | "get";
  person_name: string;
  phone: string | null;
  amount: number;
  reason: string;
  notes: string | null;
  due_date: string | null;
  status: "pending" | "paid" | "received" | "cancelled";
};

// ---------------------------------------------------------------------------
// House types
// ---------------------------------------------------------------------------
type HouseMember = {
  id: string;           // house_members.id (UUID)
  profile_id: string | null;
  name: string;
  role: "owner" | "member";
  active: boolean;
};
type HouseExpense = {
  id: string;
  title: string;
  amount: number;
  category: string;
  expense_date: string;
  paid_by: string;           // house_members.id of payer
  paid_by_name: string;      // denormalised for display
};
type HouseSettlement = {
  id: string;
  from_member_id: string;
  to_member_id: string;
  amount: number;
  settled_on: string;
};
type MemberBalance = HouseMember & { balance: number };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const workspaceKey = (userId: string) => `nestsplit:last-workspace:${userId}`;
const money = (value: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value || 0);
const todayStr = () => new Date().toISOString().slice(0, 10);
const INIT_TIMEOUT_MS = 8000;

function withTimeout<T>(work: PromiseLike<T>, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error(`${label} timed out. Check your connection and try again.`)),
      INIT_TIMEOUT_MS,
    );
    work.then(
      (value) => { window.clearTimeout(timeout); resolve(value); },
      (reason) => { window.clearTimeout(timeout); reject(reason); },
    );
  });
}

function authDebug(message: string, detail?: unknown) {
  if (process.env.NODE_ENV === "development") console.debug(`[NestSplit Auth] ${message}`, detail ?? "");
}

function validWorkspace(value: string | null, houses: House[]): Workspace | null {
  if (value === "personal") return "personal";
  if (value?.startsWith("house:") && houses.some((h) => h.id === value.slice(6))) return value as Workspace;
  return null;
}

// ---------------------------------------------------------------------------
// Root component — authentication + workspace routing (unchanged logic)
// ---------------------------------------------------------------------------
export default function NestSplit() {
  const [user, setUser] = useState<User | null>(null);
  const [houses, setHouses] = useState<House[]>([]);
  const [workspace, setWorkspace] = useState<Workspace>("selector");
  const [booting, setBooting] = useState(true);
  const [splashDone, setSplashDone] = useState(false);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const startupStarted = useRef(false);

  const selectWorkspace = useCallback(
    (next: Workspace, activeUser = user) => {
      setWorkspace(next);
      if (activeUser && next !== "selector") window.localStorage.setItem(workspaceKey(activeUser.id), next);
    },
    [user],
  );

  const hydrate = useCallback(async () => {
    const client = getSupabaseBrowserClient();
    if (!client) { setError("Supabase environment variables are missing."); setBooting(false); return; }
    try {
      authDebug("startup");
      const sessionResult = await withTimeout(client.auth.getSession(), "Session loading");
      const activeUser = sessionResult.data.session?.user ?? null;
      authDebug("getSession result", { hasSession: Boolean(activeUser), error: sessionResult?.error?.message });
      setUser(activeUser);
      if (!activeUser) { setHouses([]); setWorkspace("selector"); return; }
      const { data: profile, error: profileError } = await withTimeout(
        client.from("profiles").select("id").eq("id", activeUser.id).maybeSingle(),
        "Profile loading",
      );
      if (profileError) throw profileError;
      if (!profile) {
        const { error: profileCreateError } = await withTimeout(
          client.from("profiles").upsert({
            id: activeUser.id,
            display_name: activeUser.user_metadata.full_name || activeUser.user_metadata.name || "NestSplit member",
            avatar_url: activeUser.user_metadata.avatar_url || null,
          }),
          "Profile creation",
        );
        if (profileCreateError) throw profileCreateError;
      }
      const { data, error: housesError } = await withTimeout(
        client.from("house_members").select("houses(id,name,house_code)").eq("profile_id", activeUser.id).eq("active", true),
        "Workspace loading",
      );
      if (housesError) throw housesError;
      const activeHouses = (data || []).flatMap(
        (row: { houses: House | House[] | null }) =>
          Array.isArray(row.houses) ? row.houses : row.houses ? [row.houses] : [],
      );
      setHouses(activeHouses);
      const params = new URLSearchParams(window.location.search);
      const requestedIntent = params.get("intent");
      const intentKey = `nestsplit:consumed-intent:${activeUser.id}:${requestedIntent}`;
      const intent = requestedIntent && !window.sessionStorage.getItem(intentKey) ? requestedIntent : null;
      if (intent) window.sessionStorage.setItem(intentKey, "1");
      const saved = validWorkspace(window.localStorage.getItem(workspaceKey(activeUser.id)), activeHouses);
      const next: Workspace =
        intent === "personal" ? "personal"
        : intent === "house" ? (activeHouses.length === 1 ? `house:${activeHouses[0].id}` : "selector")
        : saved || (activeHouses.length === 1 ? `house:${activeHouses[0].id}` : "personal");
      authDebug("restoring workspace", next);
      setWorkspace(next);
      if (next !== "selector") window.localStorage.setItem(workspaceKey(activeUser.id), next);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Could not initialize NestSplit.";
      authDebug("initialization failed", message);
      setError(message);
      setHouses([]);
      setWorkspace("selector");
    } finally {
      setBooting(false);
    }
  }, []);

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    let failsafe: number | undefined;
    if (!startupStarted.current) {
      startupStarted.current = true;
      failsafe = window.setTimeout(() => {
        authDebug("initialization failsafe fired");
        setError("NestSplit took too long to start. Please retry.");
        setBooting(false);
      }, INIT_TIMEOUT_MS + 1000);
      void Promise.resolve().then(() => hydrate()).finally(() => { if (failsafe) window.clearTimeout(failsafe); });
    }
    const { data } = client?.auth.onAuthStateChange((event, session) => {
      authDebug(`auth event: ${event}`);
      if (event === "SIGNED_OUT") { setUser(null); setHouses([]); setWorkspace("selector"); }
      if ((event === "SIGNED_IN" || event === "TOKEN_REFRESHED") && session?.user) setUser(session.user);
    }) ?? { data: { subscription: { unsubscribe() {} } } };
    return () => { if (failsafe) window.clearTimeout(failsafe); data.subscription.unsubscribe(); };
  }, [hydrate]);

  const authenticate = async (intent: "personal" | "house") => {
    setError("");
    await signInWithGoogle(`/?intent=${intent}`).catch((reason) => setError(reason.message));
  };
  const logout = async () => {
    await getSupabaseBrowserClient()?.auth.signOut();
    if (user) window.localStorage.removeItem(workspaceKey(user.id));
    setUser(null); setHouses([]); setWorkspace("selector");
  };
  const createHouse = async (form: FormData) => {
    const name = String(form.get("name") || "").trim();
    if (!name) return;
    const { data, error: createError } = await getSupabaseBrowserClient()!.rpc("create_house_for_me", { house_name: name });
    if (createError) { setError(createError.message); return; }
    const house = data as House;
    setHouses((current) => [...current, house]);
    selectWorkspace(`house:${house.id}`);
    setShowCreate(false);
  };
  const joinHouse = async (form: FormData) => {
    const { data, error: joinError } = await getSupabaseBrowserClient()!.rpc("join_house_by_code", { input_code: String(form.get("code") || "") });
    if (joinError) { setError(joinError.message); return; }
    const house = data as House;
    setHouses((current) => current.some((e) => e.id === house.id) ? current : [...current, house]);
    selectWorkspace(`house:${house.id}`);
    setShowJoin(false);
  };

  if (booting && !splashDone) return (
    <AppSplash authReady={false} onDone={() => setSplashDone(true)} />
  );
  if (!user) return (
    <>
      <AppSplash authReady={!booting} onDone={() => setSplashDone(true)} />
      {splashDone && <Welcome error={error} onPersonal={() => authenticate("personal")} onHouse={() => authenticate("house")} />}
    </>
  );

  const activeHouse = workspace.startsWith("house:") ? houses.find((h) => h.id === workspace.slice(6)) : null;

  if (workspace === "selector") return (
    <>
      <AppSplash authReady={!booting} onDone={() => setSplashDone(true)} />
      <div style={splashDone ? { animation: "ns-pop 280ms cubic-bezier(.2,.8,.2,1) both" } : { opacity: 0, pointerEvents: "none" }}>
        <WorkspaceSelector
          houses={houses}
          onPersonal={() => selectWorkspace("personal")}
          onHouse={(id) => selectWorkspace(`house:${id}`)}
          onCreate={() => setShowCreate(true)}
          onJoin={() => setShowJoin(true)}
          onLogout={logout}
          error={error}
        />
        {showCreate && (
          <FormSheet title="Create House" onClose={() => setShowCreate(false)} onSubmit={createHouse}>
            <label>House name<input name="name" required autoFocus placeholder="e.g. Greenview Flat" /></label>
            <button className="sheet-submit">Create house</button>
          </FormSheet>
        )}
        {showJoin && (
          <FormSheet title="Join House" onClose={() => setShowJoin(false)} onSubmit={joinHouse}>
            <label>House code<input name="code" required autoFocus placeholder="NX-ABC123" /></label>
            <button className="sheet-submit">Join house</button>
          </FormSheet>
        )}
      </div>
    </>
  );

  // Authenticated workspace — Personal or House
  return (
    <>
      <AppSplash authReady={!booting} onDone={() => setSplashDone(true)} />
      <div style={splashDone ? { animation: "ns-pop 280ms cubic-bezier(.2,.8,.2,1) both" } : { opacity: 0, pointerEvents: "none" }}>
        <main className="app-stage">
          <section className="phone-shell">
            {workspace === "personal" ? (
              <PersonalApp user={user} onSwitchSpace={() => selectWorkspace("selector")} onLogout={logout} />
            ) : (
              <HouseApp house={activeHouse!} user={user} onSwitchSpace={() => selectWorkspace("selector")} onLogout={logout} />
            )}
            {error && <div className="toast">{error}</div>}
          </section>
          {showCreate && (
            <FormSheet title="Create House" onClose={() => setShowCreate(false)} onSubmit={createHouse}>
              <label>House name<input name="name" required autoFocus placeholder="e.g. Greenview Flat" /></label>
              <button className="sheet-submit">Create house</button>
            </FormSheet>
          )}
          {showJoin && (
            <FormSheet title="Join House" onClose={() => setShowJoin(false)} onSubmit={joinHouse}>
              <label>House code<input name="code" required autoFocus placeholder="NX-ABC123" /></label>
              <button className="sheet-submit">Join house</button>
            </FormSheet>
          )}
        </main>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Welcome screen
// ---------------------------------------------------------------------------
function Welcome({ onPersonal, onHouse, error }: { onPersonal: () => void; onHouse: () => void; error: string }) {
  return (
    <main className="app-stage">
      <section className="phone-shell auth-shell welcome-shell">
        <div className="auth-art"><div className="logo">N</div><span>Money, at home.</span></div>
        <div className="auth-copy">
          <p className="eyebrow">NESTSPLIT</p>
          <h1>Choose your space.</h1>
          <p>One secure account for your personal finances and every home you share.</p>
        </div>
        <div className="onboarding-options">
          <button onClick={onPersonal}><span>👤</span><div><b>Personal</b><small>Track my own money</small></div><i>›</i></button>
          <button onClick={onHouse}><span>🏠</span><div><b>House</b><small>Manage shared household expenses</small></div><i>›</i></button>
        </div>
        {error && <p className="auth-error">{error}</p>}
      </section>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Workspace selector
// ---------------------------------------------------------------------------
function WorkspaceSelector({ houses, onPersonal, onHouse, onCreate, onJoin, onLogout, error }: {
  houses: House[]; onPersonal: () => void; onHouse: (id: string) => void;
  onCreate: () => void; onJoin: () => void; onLogout: () => void; error: string;
}) {
  return (
    <main className="app-stage">
      <section className="phone-shell auth-shell selector-shell">
        <div className="logo">N</div>
        <div className="auth-copy"><p className="eyebrow">YOUR SPACES</p><h1>Where to?</h1><p>Switch spaces without signing in again.</p></div>
        <div className="onboarding-options">
          <button onClick={onPersonal}><span>👤</span><div><b>Personal</b><small>Your private money</small></div><i>›</i></button>
          {houses.map((house) => (
            <button key={house.id} onClick={() => onHouse(house.id)}>
              <span>🏠</span><div><b>{house.name}</b><small>{house.house_code}</small></div><i>›</i>
            </button>
          ))}
        </div>
        {houses.length === 0 && <p className="empty">You are not in a House yet. Create one or join with a code.</p>}
        <div className="auth-actions">
          <button onClick={onCreate}>Create House</button>
          <button className="outline" onClick={onJoin}>Join House</button>
          <button className="text-button" onClick={onLogout}>Log out</button>
        </div>
        {error && <div className="toast">{error}</div>}
      </section>
    </main>
  );
}

// ---------------------------------------------------------------------------
// HouseApp — full shared-expense House application
// Mirrors the PersonalApp pattern. Takes full shell ownership (header → nav).
// All data scoped to house.id via Supabase RLS (is_house_member policy).
// ---------------------------------------------------------------------------
type HouseScreen = "home" | "activity" | "insights" | "settings";
type HouseSheet = "expense" | "settlement" | "member" | null;

// Pure balance calculation — mirrors the getBalances() function from git history
// adapted to Supabase member/expense/settlement shapes.
function calcBalances(
  members: HouseMember[],
  expenses: HouseExpense[],
  settlements: HouseSettlement[],
): MemberBalance[] {
  const active = members.filter((m) => m.active);
  const totals: Record<string, number> = {};
  active.forEach((m) => { totals[m.id] = 0; });
  expenses.forEach((e) => {
    const share = active.length ? Number(e.amount) / active.length : 0;
    totals[e.paid_by] = (totals[e.paid_by] ?? 0) + Number(e.amount);
    active.forEach((m) => { totals[m.id] = (totals[m.id] ?? 0) - share; });
  });
  settlements.forEach((s) => {
    totals[s.from_member_id] = (totals[s.from_member_id] ?? 0) + Number(s.amount);
    totals[s.to_member_id]   = (totals[s.to_member_id]   ?? 0) - Number(s.amount);
  });
  return active.map((m) => ({ ...m, balance: Number((totals[m.id] ?? 0).toFixed(2)) }));
}

function HouseApp({ house, user, onSwitchSpace, onLogout }: {
  house: House;
  user: User;
  onSwitchSpace: () => void;
  onLogout: () => void;
}) {
  const [screen, setScreen]       = useState<HouseScreen>("home");
  const [sheet, setSheet]         = useState<HouseSheet>(null);
  const [notice, setNotice]       = useState("");
  const [members, setMembers]     = useState<HouseMember[]>([]);
  const [expenses, setExpenses]   = useState<HouseExpense[]>([]);
  const [settlements, setSettlements] = useState<HouseSettlement[]>([]);
  const [myMemberId, setMyMemberId]   = useState<string | null>(null);
  const [loading, setLoading]     = useState(true);

  const flash = (msg: string) => { setNotice(msg); window.setTimeout(() => setNotice(""), 2800); };

  // Load all house data
  const loadData = useCallback(async () => {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const [membersRes, expensesRes, settlementsRes] = await Promise.all([
      client
        .from("house_members")
        .select("id,profile_id,name,role,active")
        .eq("house_id", house.id)
        .order("joined_at", { ascending: true }),
      client
        .from("expenses")
        .select("id,title,amount,category,expense_date,paid_by,house_members!paid_by(name)")
        .eq("house_id", house.id)
        .order("expense_date", { ascending: false })
        .order("created_at", { ascending: false }),
      client
        .from("settlements")
        .select("id,from_member_id,to_member_id,amount,settled_on")
        .eq("house_id", house.id)
        .order("settled_on", { ascending: false }),
    ]);

    if (membersRes.data) {
      const rows = membersRes.data as (HouseMember & { profile_id: string | null })[];
      setMembers(rows);
      // Identify which member row belongs to the current auth user
      const mine = rows.find((m) => m.profile_id === user.id);
      setMyMemberId(mine?.id ?? null);
    }
    if (expensesRes.data) {
      // Flatten the joined payer name from the nested relation
      const rows = (expensesRes.data as Array<{
        id: string; title: string; amount: number; category: string;
        expense_date: string; paid_by: string;
        house_members: { name: string } | { name: string }[] | null;
      }>).map((r) => ({
        id: r.id,
        title: r.title,
        amount: r.amount,
        category: r.category,
        expense_date: r.expense_date,
        paid_by: r.paid_by,
        paid_by_name: Array.isArray(r.house_members)
          ? (r.house_members[0]?.name ?? "Member")
          : (r.house_members?.name ?? "Member"),
      }));
      setExpenses(rows);
    }
    if (settlementsRes.data) setSettlements(settlementsRes.data as HouseSettlement[]);
    setLoading(false);
  }, [house.id, user.id]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadData(); }, [loadData]);

  // Derived
  const thisMonthKey    = new Date().toISOString().slice(0, 7);
  const activeMembers   = useMemo(() => members.filter((m) => m.active), [members]);
  const monthExpenses   = useMemo(() => expenses.filter((e) => e.expense_date.slice(0, 7) === thisMonthKey), [expenses, thisMonthKey]);
  const monthTotal      = useMemo(() => monthExpenses.reduce((s, e) => s + Number(e.amount), 0), [monthExpenses]);
  const balances        = useMemo(() => calcBalances(members, expenses, settlements), [members, expenses, settlements]);
  const myBalance       = useMemo(() => balances.find((b) => b.id === myMemberId)?.balance ?? 0, [balances, myMemberId]);
  const myMember        = useMemo(() => members.find((m) => m.id === myMemberId) ?? null, [members, myMemberId]);
  const isOwner         = myMember?.role === "owner";
  const currentMonthName = new Date().toLocaleDateString("en-IN", { month: "long" });

  const categoryTotals  = useMemo(() => {
    const map: Record<string, number> = {};
    expenses.forEach((e) => { map[e.category] = (map[e.category] ?? 0) + Number(e.amount); });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [expenses]);

  const monthlyTrend = useMemo(() => {
    const map: Record<string, number> = {};
    expenses.forEach((e) => {
      const k = e.expense_date.slice(0, 7);
      map[k] = (map[k] ?? 0) + Number(e.amount);
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).slice(-6);
  }, [expenses]);

  const recent = expenses.slice(0, 5);

  if (loading) return (
    <>
      <HouseHeader
        house={house}
        memberCount={0}
        myMember={null}
        isOwner={false}
        onSwitchSpace={onSwitchSpace}
        onOpenSettings={() => {/* loading */}}
      />
      <div className="content" style={{ paddingTop: 20 }}>
        <p className="empty">Loading {house.name}…</p>
      </div>
    </>
  );

  return (
    <>
      <HouseHeader
        house={house}
        memberCount={activeMembers.length}
        myMember={myMember}
        isOwner={isOwner}
        onSwitchSpace={onSwitchSpace}
        onOpenSettings={() => setScreen("settings")}
      />

      <div className="content">
        {/* ── HOME ── */}
        {screen === "home" && (
          <>
            <section className="hero-card">
              <p>HOUSEHOLD EXPENSE</p>
              <strong>{money(monthTotal)}</strong>
              <span>{currentMonthName} · {activeMembers.length} members</span>
              <div className="balance-chip">
                <span>{myBalance >= 0 ? "You get back" : "You owe"}</span>
                <b>{money(Math.abs(myBalance))}</b>
              </div>
            </section>

            <div className="section-title">
              <h2>Quick add</h2>
              <button onClick={() => setSheet("expense")}>Add expense</button>
            </div>
            <button className="quick-add" onClick={() => setSheet("expense")}>
              <span>＋</span>
              <div><b>Record an expense</b><small>Split equally with the house</small></div>
              <i>›</i>
            </button>

            <div className="section-title">
              <h2>Recent expenses</h2>
              <button onClick={() => setScreen("activity")}>See all</button>
            </div>
            <HouseExpenseList expenses={recent} members={members} />

            {categoryTotals.length > 0 && (
              <>
                <div className="section-title"><h2>This month</h2></div>
                <section className="summary-card">
                  <div><small>Daily average</small><b>{money(monthTotal / Math.max(new Date().getDate(), 1))}</b></div>
                  <div><small>Top category</small><b>{categoryTotals[0]?.[0] ?? "—"}</b></div>
                </section>
                <button className="insight-card" onClick={() => setScreen("insights")}>
                  <span>✦</span>
                  <div>
                    <small>SMALL INSIGHT</small>
                    <b>{categoryTotals[0] ? `${categoryTotals[0][0]} is the largest shared expense.` : "Add an expense to unlock insights."}</b>
                  </div>
                  <i>›</i>
                </button>
              </>
            )}
          </>
        )}

        {/* ── ACTIVITY ── */}
        {screen === "activity" && (
          <>
            <p className="screen-copy">Every shared expense and settlement in one place.</p>
            <div className="section-title"><h2>All expenses</h2><button onClick={() => setSheet("expense")}>Add</button></div>
            <HouseExpenseList expenses={expenses} members={members} full />
            <button className="secondary-action" onClick={() => setSheet("settlement")}>Record a settlement</button>
          </>
        )}

        {/* ── INSIGHTS ── */}
        {screen === "insights" && (
          <>
            <section className="insight-hero">
              <small>MONTHLY SUMMARY</small>
              <strong>{money(monthTotal)}</strong>
              <span>{monthExpenses.length} expense{monthExpenses.length !== 1 ? "s" : ""} this month</span>
            </section>
            <div className="section-title"><h2>Spend by category</h2></div>
            <section className="chart-card">
              {categoryTotals.length
                ? categoryTotals.map(([name, value]) => (
                    <div className="bar-row" key={name}>
                      <div><span>{name}</span><b>{money(value)}</b></div>
                      <i><em style={{ width: `${Math.max(10, (value / categoryTotals[0][1]) * 100)}%` }} /></i>
                    </div>
                  ))
                : <p className="empty">Your categories will appear here.</p>}
            </section>
            {monthlyTrend.length > 0 && (
              <>
                <div className="section-title"><h2>Monthly trend</h2></div>
                <section className="chart-card">
                  <MonthlyTrendBars data={monthlyTrend} />
                </section>
              </>
            )}
            <div className="section-title"><h2>Balances</h2></div>
            <div className="balance-list">
              {balances.map((b) => (
                <div key={b.id}>
                  <div className="mini-avatar">{b.name[0]?.toUpperCase()}</div>
                  <span>{b.name}</span>
                  <b className={b.balance >= 0 ? "positive" : "negative"}>
                    {b.balance >= 0 ? "gets " : "owes "}{money(Math.abs(b.balance))}
                  </b>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── SETTINGS ── */}
        {screen === "settings" && (
          <>
            <section className="profile-card">
              <div className="profile-avatar" style={{ fontSize: 22, fontWeight: 800 }}>
                {myMember?.name.slice(0, 1).toUpperCase() ?? "H"}
              </div>
              <div>
                <b>{myMember?.name ?? house.name}</b>
                <small>{user.email} · {isOwner ? "Owner" : "Member"}</small>
              </div>
            </section>

            {isOwner && (
              <section className="members-card">
                <div>
                  <b>Members</b>
                  <button onClick={() => setSheet("member")}>Add</button>
                </div>
                {activeMembers.map((m) => (
                  <p key={m.id}>
                    <span>
                      {m.name}
                      <small>{m.role === "owner" ? "Owner" : "Member"}</small>
                    </span>
                    {m.role === "member" && (
                      <button onClick={() => void deactivateMember(house.id, m.id, loadData, flash)}>
                        Deactivate
                      </button>
                    )}
                  </p>
                ))}
              </section>
            )}

            <div className="setting-group">
              <small>HOUSE</small>
              <button onClick={() => flash(`House code: ${house.house_code}`)}><span>⌁</span>House code <b>{house.house_code}</b></button>
              {isOwner && <button onClick={() => setSheet("member")}><span>＋</span>Manage members <b>{activeMembers.length}</b></button>}
            </div>
            <div className="setting-group">
              <small>ACCOUNT</small>
              <button onClick={onSwitchSpace}><span>⌁</span>Switch space <b>›</b></button>
              <button onClick={onLogout}><span>↪</span>Log out <b>›</b></button>
            </div>
          </>
        )}
      </div>

      {/* The nav-add button in the bottom-nav below handles the add-expense
          action. No separate FAB needed — the .fab CSS class hides it anyway
          and an inline override was causing a stray "+" on the activity screen. */}

      {/* Bottom navigation */}
      <nav className="bottom-nav">
        {([
          ["home",     "⌂", "Home"],
          ["activity", "◷", "Activity"],
          ["add",      "＋", ""],
          ["insights", "◔", "Insights"],
          ["settings", "⚙", "Settings"],
        ] as const).map(([key, icon, label]) => (
          <button
            key={key}
            className={screen === key ? "active" : key === "add" ? "nav-add" : ""}
            onClick={() => key === "add" ? setSheet("expense") : setScreen(key as HouseScreen)}
          >
            <i>{icon}</i>
            {label && <span>{label}</span>}
          </button>
        ))}
      </nav>

      {/* Sheets */}
      {sheet === "expense" && myMemberId && (
        <HouseExpenseSheet
          houseId={house.id}
          members={activeMembers}
          myMemberId={myMemberId}
          onClose={() => setSheet(null)}
          onSaved={() => { setSheet(null); flash("Expense added."); void loadData(); }}
          flash={flash}
        />
      )}
      {sheet === "settlement" && myMemberId && (
        <HouseSettlementSheet
          houseId={house.id}
          members={activeMembers}
          myMemberId={myMemberId}
          onClose={() => setSheet(null)}
          onSaved={() => { setSheet(null); void loadData(); }}
          flash={flash}
        />
      )}
      {sheet === "member" && isOwner && (
        <HouseMemberSheet
          houseCode={house.house_code}
          onClose={() => setSheet(null)}
          flash={flash}
        />
      )}

      {notice && <div className="toast">{notice}</div>}
    </>
  );
}

// ---------------------------------------------------------------------------
// Generic FormSheet used by selector overlays
// ---------------------------------------------------------------------------
function FormSheet({ title, onClose, onSubmit, children }: {
  title: string; onClose: () => void; onSubmit: (form: FormData) => Promise<void>; children: React.ReactNode;
}) {
  return (
    <div className="sheet-backdrop" onMouseDown={onClose}>
      <form
        className="sheet"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); void onSubmit(new FormData(e.currentTarget)); }}
      >
        <div className="sheet-handle" />
        <div className="sheet-head"><h2>{title}</h2><button type="button" onClick={onClose}>×</button></div>
        {children}
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PWA install hook — captures beforeinstallprompt, detects standalone mode.
// Returns:
//   installable  — true when the browser has a deferred prompt ready
//   isStandalone — true when running as an installed PWA
//   triggerInstall — call to show the native install prompt
// ---------------------------------------------------------------------------
function usePWAInstall() {
  // BeforeInstallPromptEvent is not in the standard TS lib; we cast as needed.
  const promptRef = useRef<Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> } | null>(null);
  const [installable, setInstallable] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    // Detect standalone mode (installed PWA or added to home screen)
    if (typeof window !== "undefined") {
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        // iOS Safari sets this property when launched from home screen
        ("standalone" in window.navigator && (window.navigator as { standalone?: boolean }).standalone === true);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsStandalone(standalone);
    }

    const handler = (e: Event) => {
      // Prevent the default mini-infobar from appearing on mobile
      e.preventDefault();
      promptRef.current = e as typeof promptRef.current;
      setInstallable(true);
    };
    window.addEventListener("beforeinstallprompt", handler);

    // If the app is installed the appinstalled event fires; clear the button
    const installedHandler = () => { setInstallable(false); setIsStandalone(true); };
    window.addEventListener("appinstalled", installedHandler);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installedHandler);
    };
  }, []);

  const triggerInstall = useCallback(async () => {
    if (!promptRef.current) return;
    await promptRef.current.prompt();
    const choice = await promptRef.current.userChoice;
    if (choice.outcome === "accepted") {
      setInstallable(false);
    }
    promptRef.current = null;
  }, []);

  return { installable, isStandalone, triggerInstall };
}

// ---------------------------------------------------------------------------
// PersonalApp — full Personal money manager
// Replaces the old PersonalHome() placeholder.
// All data is scoped to auth.uid() via Supabase RLS.
// ---------------------------------------------------------------------------
type PersonalScreen = "home" | "activity" | "insights" | "settings";
type PersonalSheet = "transaction" | "money_item" | null;

function PersonalApp({ user, onSwitchSpace, onLogout }: {
  user: User;
  onSwitchSpace: () => void;
  onLogout: () => void;
}) {
  const [screen, setScreen] = useState<PersonalScreen>("home");
  const [sheet, setSheet] = useState<PersonalSheet>(null);
  const [notice, setNotice] = useState("");
  const [transactions, setTransactions] = useState<PersonalTransaction[]>([]);
  const [moneyItems, setMoneyItems] = useState<MoneyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { installable, isStandalone, triggerInstall } = usePWAInstall();

  const displayName = user.user_metadata?.full_name || user.user_metadata?.name || user.email || "You";
  const firstName = displayName.split(" ")[0];
  const avatarLetter = firstName[0]?.toUpperCase() ?? "U";

  const flash = (msg: string) => { setNotice(msg); window.setTimeout(() => setNotice(""), 2800); };

  // Load all personal data
  const loadData = useCallback(async () => {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const [txRes, miRes] = await Promise.all([
      client
        .from("personal_transactions")
        .select("id,transaction_kind,amount,category,description,notes,transaction_date")
        .eq("user_id", user.id)
        .order("transaction_date", { ascending: false })
        .order("created_at", { ascending: false }),
      client
        .from("personal_money_items")
        .select("id,direction,person_name,phone,amount,reason,notes,due_date,status")
        .eq("user_id", user.id)
        .in("status", ["pending"])
        .order("due_date", { ascending: true }),
    ]);
    if (txRes.data) setTransactions(txRes.data as PersonalTransaction[]);
    if (miRes.data) setMoneyItems(miRes.data as MoneyItem[]);
    setLoading(false);
  }, [user.id]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadData(); }, [loadData]);

  // Derived stats
  const thisMonthKey = new Date().toISOString().slice(0, 7);
  const monthTx = useMemo(
    () => transactions.filter((t) => t.transaction_date.slice(0, 7) === thisMonthKey),
    [transactions, thisMonthKey],
  );
  const monthSpent = useMemo(() => monthTx.filter((t) => t.transaction_kind === "expense").reduce((s, t) => s + Number(t.amount), 0), [monthTx]);
  const monthIncome = useMemo(() => monthTx.filter((t) => t.transaction_kind === "income").reduce((s, t) => s + Number(t.amount), 0), [monthTx]);
  const toGet = useMemo(() => moneyItems.filter((m) => m.direction === "get").reduce((s, m) => s + Number(m.amount), 0), [moneyItems]);
  const toGive = useMemo(() => moneyItems.filter((m) => m.direction === "give").reduce((s, m) => s + Number(m.amount), 0), [moneyItems]);

  const categoryTotals = useMemo(() => {
    const map: Record<string, number> = {};
    transactions.filter((t) => t.transaction_kind === "expense").forEach((t) => {
      map[t.category] = (map[t.category] || 0) + Number(t.amount);
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [transactions]);

  const monthlyTrend = useMemo(() => {
    const map: Record<string, number> = {};
    transactions.filter((t) => t.transaction_kind === "expense").forEach((t) => {
      const k = t.transaction_date.slice(0, 7);
      map[k] = (map[k] || 0) + Number(t.amount);
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).slice(-6);
  }, [transactions]);

  const recent = transactions.slice(0, 5);
  const currentMonthName = new Date().toLocaleDateString("en-IN", { month: "long" });

  if (loading) return (
    <div className="content" style={{ paddingTop: 80 }}>
      <p className="empty">Loading your finances…</p>
    </div>
  );

  return (
    <>
      <header className="app-header">
        <button className="space-title" onClick={onSwitchSpace}>
          <small>PERSONAL</small>
          <b>👤 {firstName} <i>⌄</i></b>
        </button>
        <button className="bell" onClick={() => setScreen("settings")} aria-label="Settings">
          <span style={{ fontSize: 16, fontWeight: 800 }}>{avatarLetter}</span>
        </button>
      </header>

      <div className="content">
        {/* ── HOME ── */}
        {screen === "home" && (
          <>
            <section className="hero-card personal-hero">
              <p>THIS MONTH</p>
              <strong>{money(monthSpent)}</strong>
              <span>{currentMonthName} · {monthTx.length} transactions</span>
              <div className="balance-chip">
                <span>Income <b>{money(monthIncome)}</b></span>
                <span>Spent <b>{money(monthSpent)}</b></span>
              </div>
            </section>

            {(toGet > 0 || toGive > 0) && (
              <div className="pending-summary">
                {toGet > 0 && <div><small>TO COLLECT</small><b style={{ color: "var(--green)" }}>{money(toGet)}</b></div>}
                {toGive > 0 && <div><small>TO GIVE</small><b style={{ color: "#bf5d51" }}>{money(toGive)}</b></div>}
              </div>
            )}

            <div className="section-title">
              <h2>Quick add</h2>
              <button onClick={() => setSheet("transaction")}>Add transaction</button>
            </div>
            <button className="quick-add" onClick={() => setSheet("transaction")}>
              <span>＋</span>
              <div><b>Record a transaction</b><small>Expense or income, all yours</small></div>
              <i>›</i>
            </button>

            {moneyItems.length > 0 && (
              <>
                <div className="section-title">
                  <h2>Give / Get</h2>
                  <button onClick={() => setSheet("money_item")}>Add</button>
                </div>
                <MoneyItemList items={moneyItems.slice(0, 3)} onComplete={(id) => void completeMoneyItem(id, loadData, flash)} />
              </>
            )}
            {moneyItems.length === 0 && (
              <>
                <div className="section-title">
                  <h2>Give / Get</h2>
                  <button onClick={() => setSheet("money_item")}>Add</button>
                </div>
                <button className="quick-add" onClick={() => setSheet("money_item")}>
                  <span>⇄</span>
                  <div><b>Track money you owe or are owed</b><small>Set due dates and get reminders</small></div>
                  <i>›</i>
                </button>
              </>
            )}

            <div className="section-title">
              <h2>Recent transactions</h2>
              <button onClick={() => setScreen("activity")}>See all</button>
            </div>
            <TransactionList transactions={recent} />

            {categoryTotals.length > 0 && (
              <>
                <div className="section-title"><h2>This month</h2></div>
                <section className="summary-card">
                  <div><small>Daily average</small><b>{money(monthSpent / Math.max(new Date().getDate(), 1))}</b></div>
                  <div><small>Top category</small><b>{categoryTotals[0]?.[0] || "—"}</b></div>
                </section>
                <button className="insight-card" onClick={() => setScreen("insights")}>
                  <span>✦</span>
                  <div>
                    <small>SMALL INSIGHT</small>
                    <b>{categoryTotals[0] ? `${categoryTotals[0][0]} is your biggest expense.` : "Add a transaction to unlock insights."}</b>
                  </div>
                  <i>›</i>
                </button>
              </>
            )}
          </>
        )}

        {/* ── ACTIVITY ── */}
        {screen === "activity" && (
          <>
            <p className="screen-copy">Every transaction in one place, private to you.</p>
            {moneyItems.length > 0 && (
              <>
                <div className="section-title"><h2>Pending Give / Get</h2><button onClick={() => setSheet("money_item")}>Add</button></div>
                <MoneyItemList items={moneyItems} onComplete={(id) => void completeMoneyItem(id, loadData, flash)} />
              </>
            )}
            <div className="section-title"><h2>All transactions</h2><button onClick={() => setSheet("transaction")}>Add</button></div>
            <TransactionList transactions={transactions} full />
          </>
        )}

        {/* ── INSIGHTS ── */}
        {screen === "insights" && (
          <>
            <section className="insight-hero">
              <small>MONTHLY SUMMARY</small>
              <strong>{money(monthSpent)}</strong>
              <span>{monthTx.filter((t) => t.transaction_kind === "expense").length} expenses this month</span>
            </section>
            <div className="section-title"><h2>Spend by category</h2></div>
            <section className="chart-card">
              {categoryTotals.length
                ? categoryTotals.map(([name, value]) => (
                    <div className="bar-row" key={name}>
                      <div><span>{name}</span><b>{money(value)}</b></div>
                      <i><em style={{ width: `${Math.max(10, (value / categoryTotals[0][1]) * 100)}%` }} /></i>
                    </div>
                  ))
                : <p className="empty">Your categories will appear here.</p>}
            </section>
            {monthlyTrend.length > 0 && (
              <>
                <div className="section-title"><h2>Monthly trend</h2></div>
                <section className="chart-card">
                  <MonthlyTrendBars data={monthlyTrend} />
                </section>
              </>
            )}
            {moneyItems.length > 0 && (
              <>
                <div className="section-title"><h2>Money to collect / give</h2></div>
                <div className="balance-list">
                  {moneyItems.map((item) => (
                    <div key={item.id}>
                      <div className="mini-avatar">{item.person_name[0]?.toUpperCase()}</div>
                      <span>{item.person_name} — {item.reason}</span>
                      <b className={item.direction === "get" ? "positive" : "negative"}>
                        {item.direction === "get" ? "collect " : "give "}{money(Number(item.amount))}
                      </b>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {/* ── SETTINGS ── */}
        {screen === "settings" && (
          <>
            <section className="profile-card">
              <div className="profile-avatar" style={{ fontSize: 22, fontWeight: 800 }}>{avatarLetter}</div>
              <div>
                <b>{displayName}</b>
                <small>{user.email}</small>
              </div>
            </section>
            <div className="setting-group">
              <small>PERSONAL SPACE</small>
              <button onClick={() => setSheet("transaction")}><span>＋</span>Add transaction <b>›</b></button>
              <button onClick={() => setSheet("money_item")}><span>⇄</span>Add Give / Get <b>›</b></button>
              <button onClick={() => setScreen("insights")}><span>◔</span>View insights <b>›</b></button>
            </div>
            {/* Install app — shown only when the browser has a deferred prompt */}
            {installable && (
              <div className="setting-group">
                <small>APP</small>
                <button onClick={() => void triggerInstall()}>
                  <span>⬇</span>Install NestSplit <b>Add to home screen</b>
                </button>
              </div>
            )}
            {/* Confirmation when already running as installed PWA */}
            {isStandalone && !installable && (
              <div className="setting-group">
                <small>APP</small>
                <button style={{ color: "var(--muted)", cursor: "default" }} onClick={() => flash("NestSplit is already installed on this device.")}>
                  <span>✓</span>NestSplit installed <b>Running as app</b>
                </button>
              </div>
            )}
            <div className="setting-group">
              <small>ACCOUNT</small>
              <button onClick={onSwitchSpace}><span>⌁</span>Switch space <b>›</b></button>
              <button onClick={onLogout}><span>↪</span>Log out <b>›</b></button>
            </div>
          </>
        )}
      </div>

      {/* FAB */}
      <button className="fab" onClick={() => setSheet("transaction")} aria-label="Add transaction" style={{ display: "grid" }}>＋</button>

      {/* Bottom navigation */}
      <nav className="bottom-nav">
        {([
          ["home", "⌂", "Home"],
          ["activity", "◷", "Activity"],
          ["add", "＋", ""],
          ["insights", "◔", "Insights"],
          ["settings", "⚙", "Settings"],
        ] as const).map(([key, icon, label]) => (
          <button
            key={key}
            className={screen === key ? "active" : key === "add" ? "nav-add" : ""}
            onClick={() => key === "add" ? setSheet("transaction") : setScreen(key as PersonalScreen)}
          >
            <i>{icon}</i>
            {label && <span>{label}</span>}
          </button>
        ))}
      </nav>

      {/* Sheets */}
      {sheet === "transaction" && (
        <TransactionSheet
          userId={user.id}
          onClose={() => setSheet(null)}
          onSaved={() => { setSheet(null); void loadData(); }}
          flash={flash}
        />
      )}
      {sheet === "money_item" && (
        <MoneyItemSheet
          userId={user.id}
          onClose={() => setSheet(null)}
          onSaved={() => { setSheet(null); void loadData(); }}
          flash={flash}
        />
      )}

      {notice && <div className="toast">{notice}</div>}
    </>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TransactionList({ transactions, full = false }: { transactions: PersonalTransaction[]; full?: boolean }) {
  if (!transactions.length) return <p className="empty">No transactions yet. Add your first one.</p>;
  return (
    <div className={full ? "expense-list full" : "expense-list"}>
      {transactions.map((t) => (
        <div className="expense-row" key={t.id}>
          <div className={`expense-icon${t.transaction_kind === "income" ? " income" : ""}`}>
            {t.category[0]?.toUpperCase()}
          </div>
          <div>
            <b>{t.description}</b>
            <small>{t.category} · {new Date(t.transaction_date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</small>
          </div>
          <div>
            <b className={t.transaction_kind === "income" ? "positive" : ""}>
              {t.transaction_kind === "income" ? "+" : "−"}{money(Number(t.amount))}
            </b>
          </div>
        </div>
      ))}
    </div>
  );
}

function MoneyItemList({ items, onComplete }: { items: MoneyItem[]; onComplete: (id: string) => void }) {
  if (!items.length) return null;
  return (
    <div className="expense-list">
      {items.map((item) => (
        <div className="expense-row" key={item.id} style={{ gridTemplateColumns: "40px 1fr auto auto" }}>
          <div className={`expense-icon${item.direction === "get" ? " income" : ""}`}>
            {item.direction === "get" ? "↑" : "↓"}
          </div>
          <div>
            <b>{item.person_name}</b>
            <small>{item.reason}{item.due_date ? ` · due ${new Date(item.due_date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : ""}</small>
          </div>
          <b className={item.direction === "get" ? "positive" : "negative"}>
            {item.direction === "get" ? "+" : "−"}{money(Number(item.amount))}
          </b>
          <button
            onClick={() => onComplete(item.id)}
            style={{ border: 0, background: "#e6f6da", color: "var(--green)", borderRadius: 8, padding: "5px 8px", fontSize: 10, fontWeight: 800, marginLeft: 6 }}
          >
            Done
          </button>
        </div>
      ))}
    </div>
  );
}

function MonthlyTrendBars({ data }: { data: [string, number][] }) {
  const max = Math.max(...data.map(([, v]) => v), 1);
  return (
    <div className="monthly-trend">
      {data.map(([key, value]) => (
        <div key={key}>
          <span style={{ height: `${Math.max(8, (value / max) * 100)}%` }} />
          <small>{new Date(key + "-01T00:00:00").toLocaleDateString("en-IN", { month: "short" })}</small>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add-transaction sheet — writes to personal_transactions
// ---------------------------------------------------------------------------
const PERSONAL_CATEGORIES = ["Food", "Transport", "Bills", "Health", "Shopping", "Entertainment", "Rent", "Other"];

function TransactionSheet({ userId, onClose, onSaved, flash }: {
  userId: string; onClose: () => void; onSaved: () => void; flash: (msg: string) => void;
}) {
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [saving, setSaving] = useState(false);

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const description = String(form.get("description") || "").trim();
    const amount = Number(form.get("amount"));
    const category = String(form.get("category") || "Other");
    const txDate = String(form.get("transaction_date") || todayStr());
    const notes = String(form.get("notes") || "").trim() || null;
    if (!description || amount <= 0) { flash("Enter a description and a positive amount."); return; }
    setSaving(true);
    const client = getSupabaseBrowserClient();
    const { error } = await client!
      .from("personal_transactions")
      .insert({ user_id: userId, transaction_kind: kind, amount, category, description, notes, transaction_date: txDate });
    setSaving(false);
    if (error) { flash(error.message); return; }
    onSaved();
  };

  return (
    <div className="sheet-backdrop" onMouseDown={onClose}>
      <section className="sheet" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-head">
          <h2>Add transaction</h2>
          <button type="button" onClick={onClose}>×</button>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <button
            type="button"
            onClick={() => setKind("expense")}
            style={{ flex: 1, padding: "9px", borderRadius: 10, border: "1px solid #dde3dc", background: kind === "expense" ? "var(--green)" : "#fff", color: kind === "expense" ? "#fff" : "var(--ink)", fontWeight: 800 }}
          >Expense</button>
          <button
            type="button"
            onClick={() => setKind("income")}
            style={{ flex: 1, padding: "9px", borderRadius: 10, border: "1px solid #dde3dc", background: kind === "income" ? "#278153" : "#fff", color: kind === "income" ? "#fff" : "var(--ink)", fontWeight: 800 }}
          >Income</button>
        </div>
        <form onSubmit={(e) => { void save(e); }}>
          <label>Description<input name="description" placeholder="e.g. Groceries" autoFocus required /></label>
          <label>Amount<input name="amount" type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="0" required /></label>
          <label>Category
            <select name="category">
              {PERSONAL_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label>Date<input name="transaction_date" type="date" defaultValue={todayStr()} /></label>
          <label>Notes (optional)<input name="notes" placeholder="Any extra detail" /></label>
          <button className="sheet-submit" type="submit" disabled={saving}>{saving ? "Saving…" : kind === "expense" ? "Add expense" : "Add income"}</button>
        </form>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Give/Get sheet — writes to personal_money_items
// ---------------------------------------------------------------------------
function MoneyItemSheet({ userId, onClose, onSaved, flash }: {
  userId: string; onClose: () => void; onSaved: () => void; flash: (msg: string) => void;
}) {
  const [direction, setDirection] = useState<"give" | "get">("get");
  const [saving, setSaving] = useState(false);

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const person_name = String(form.get("person_name") || "").trim();
    const amount = Number(form.get("amount"));
    const reason = String(form.get("reason") || "").trim();
    const due_date = String(form.get("due_date") || "").trim() || null;
    const phone = String(form.get("phone") || "").trim() || null;
    const notes = String(form.get("notes") || "").trim() || null;
    if (!person_name || amount <= 0 || !reason) { flash("Fill in the person name, amount, and reason."); return; }
    setSaving(true);
    const client = getSupabaseBrowserClient();
    const { error } = await client!
      .from("personal_money_items")
      .insert({ user_id: userId, direction, person_name, phone, amount, reason, notes, due_date, status: "pending" });
    setSaving(false);
    if (error) { flash(error.message); return; }
    onSaved();
  };

  return (
    <div className="sheet-backdrop" onMouseDown={onClose}>
      <section className="sheet" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-head">
          <h2>{direction === "get" ? "Money to collect" : "Money to give"}</h2>
          <button type="button" onClick={onClose}>×</button>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <button
            type="button"
            onClick={() => setDirection("get")}
            style={{ flex: 1, padding: "9px", borderRadius: 10, border: "1px solid #dde3dc", background: direction === "get" ? "#278153" : "#fff", color: direction === "get" ? "#fff" : "var(--ink)", fontWeight: 800 }}
          >They owe me</button>
          <button
            type="button"
            onClick={() => setDirection("give")}
            style={{ flex: 1, padding: "9px", borderRadius: 10, border: "1px solid #dde3dc", background: direction === "give" ? "var(--green)" : "#fff", color: direction === "give" ? "#fff" : "var(--ink)", fontWeight: 800 }}
          >I owe them</button>
        </div>
        <form onSubmit={(e) => { void save(e); }}>
          <label>Person name<input name="person_name" placeholder="Who?" autoFocus required /></label>
          <label>Amount<input name="amount" type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="0" required /></label>
          <label>Reason<input name="reason" placeholder="For what?" required /></label>
          <label>Due date (optional)<input name="due_date" type="date" /></label>
          <label>Phone (optional)<input name="phone" inputMode="tel" placeholder="Mobile number" /></label>
          <label>Notes (optional)<input name="notes" placeholder="Any extra detail" /></label>
          <button className="sheet-submit" type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        </form>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Complete a money item via RPC (marks it paid/received + creates transaction)
// ---------------------------------------------------------------------------
async function completeMoneyItem(id: string, reload: () => Promise<void>, flash: (msg: string) => void) {
  const client = getSupabaseBrowserClient();
  if (!client) return;
  const { error } = await client.rpc("complete_personal_money_item", { item_id: id });
  if (error) { flash(error.message); return; }
  flash("Marked as done — transaction recorded.");
  await reload();
}

// ---------------------------------------------------------------------------
// HouseHeader — premium House identity card
// Replaces the plain text header with a branded, informative header.
// ---------------------------------------------------------------------------
function HouseHeader({ house, memberCount, myMember, isOwner, onSwitchSpace, onOpenSettings }: {
  house: House;
  memberCount: number;
  myMember: HouseMember | null;
  isOwner: boolean;
  onSwitchSpace: () => void;
  onOpenSettings: () => void;
}) {
  const initial = myMember?.name.slice(0, 1).toUpperCase() ?? "?";
  const subtitle = [
    memberCount > 0 ? `${memberCount} member${memberCount !== 1 ? "s" : ""}` : null,
    house.house_code,
  ].filter(Boolean).join(" · ");

  return (
    <header className="house-header">
      {/* Left: House avatar + identity — tapping opens space switcher */}
      <button className="house-identity" onClick={onSwitchSpace} aria-label="Switch space">
        <div className="house-avatar" aria-hidden="true">🏡</div>
        <div className="house-identity-text">
          <span className="house-name">{house.name}</span>
          {subtitle && <span className="house-subtitle">{subtitle}</span>}
          {isOwner && <span className="house-role-badge">OWNER</span>}
        </div>
        <span className="house-chevron" aria-hidden="true">⌄</span>
      </button>

      {/* Right: user profile initial — tapping opens settings */}
      <button className="bell" onClick={onOpenSettings} aria-label="Settings">
        <span style={{ fontSize: 13, fontWeight: 800 }}>{initial}</span>
      </button>
    </header>
  );
}

// ---------------------------------------------------------------------------
// House sub-components
// ---------------------------------------------------------------------------

function HouseExpenseList({ expenses, members, full = false }: {
  expenses: HouseExpense[];
  members: HouseMember[];
  full?: boolean;
}) {
  if (!expenses.length) return <p className="empty">No expenses yet. Add the first one.</p>;
  const nameById = Object.fromEntries(members.map((m) => [m.id, m.name]));
  return (
    <div className={full ? "expense-list full" : "expense-list"}>
      {expenses.map((e) => (
        <div className="expense-row" key={e.id}>
          <div className="expense-icon">{e.category.slice(0, 1).toUpperCase()}</div>
          <div>
            <b>{e.title}</b>
            <small>
              {e.category} · Paid by {nameById[e.paid_by] ?? e.paid_by_name} ·{" "}
              {new Date(e.expense_date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
            </small>
          </div>
          <div><b>{money(Number(e.amount))}</b></div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// House — Add Expense sheet
// Calls add_house_expense RPC which computes equal splits server-side.
// ---------------------------------------------------------------------------
const HOUSE_CATEGORIES = ["Food", "Rent", "Bills", "Transport", "Other"];

function HouseExpenseSheet({ houseId, members, myMemberId, onClose, onSaved, flash }: {
  houseId: string;
  members: HouseMember[];
  myMemberId: string;
  onClose: () => void;
  onSaved: () => void;
  flash: (msg: string) => void;
}) {
  const [saving, setSaving] = useState(false);

  const save = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const title    = String(form.get("title") || "").trim();
    const amount   = Number(form.get("amount"));
    const category = String(form.get("category") || "Other");
    const date     = String(form.get("date") || todayStr());
    const paidBy   = String(form.get("paid_by") || myMemberId);
    if (!title || amount <= 0) { flash("Enter a title and a positive amount."); return; }
    setSaving(true);
    const client = getSupabaseBrowserClient();
    const { error } = await client!.rpc("add_house_expense", {
      input_house_id:  houseId,
      input_title:     title,
      input_amount:    amount,
      input_category:  category,
      input_date:      date,
      input_paid_by:   paidBy,
      // participant_ids must be sent explicitly so PostgREST can match the
      // 7-param function signature in its schema cache. Passing null lets the
      // DB default to all active members (equal split).
      participant_ids: null,
    });
    setSaving(false);
    if (error) {
      if (process.env.NODE_ENV === "development") console.error("[add_house_expense]", error);
      // Surface a human-readable message; hide raw Postgres detail from users.
      const msg = error.message.includes("Not a house member")
        ? "You are not an active member of this house."
        : error.message.includes("title and positive amount")
        ? "Enter a title and a positive amount."
        : error.message.includes("Invalid payer")
        ? "The selected payer is not an active house member."
        : "Couldn't save the expense. Please try again.";
      flash(msg);
      return;
    }
    onSaved();
  };

  return (
    <div className="sheet-backdrop" onMouseDown={onClose}>
      <section className="sheet" onMouseDown={(ev) => ev.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-head">
          <h2>Add expense</h2>
          <button type="button" onClick={onClose}>×</button>
        </div>
        <form onSubmit={(ev) => { void save(ev); }}>
          <label>What was it?<input name="title" placeholder="e.g. Groceries" autoFocus required /></label>
          <label>Amount<input name="amount" type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="0" required /></label>
          <label>Category
            <select name="category">
              {HOUSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label>Paid by
            <select name="paid_by" defaultValue={myMemberId}>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <label>Date<input name="date" type="date" defaultValue={todayStr()} /></label>
          <button className="sheet-submit" type="submit" disabled={saving}>{saving ? "Saving…" : "Add expense"}</button>
        </form>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// House — Record Settlement sheet
// Calls record_house_settlement RPC.
// ---------------------------------------------------------------------------
function HouseSettlementSheet({ houseId, members, myMemberId, onClose, onSaved, flash }: {
  houseId: string;
  members: HouseMember[];
  myMemberId: string;
  onClose: () => void;
  onSaved: () => void;
  flash: (msg: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const others = members.filter((m) => m.id !== myMemberId);

  const save = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form   = new FormData(e.currentTarget);
    const to     = String(form.get("to") || "");
    const amount = Number(form.get("amount"));
    const date   = String(form.get("date") || todayStr());
    if (!to || amount <= 0) { flash("Choose who you paid and the amount."); return; }
    setSaving(true);
    const client = getSupabaseBrowserClient();
    const { error } = await client!.rpc("record_house_settlement", {
      input_house_id:      houseId,
      recipient_member_id: to,
      input_amount:        amount,
      input_date:          date,
    });
    setSaving(false);
    if (error) { flash(error.message); return; }
    onSaved();
  };

  return (
    <div className="sheet-backdrop" onMouseDown={onClose}>
      <section className="sheet" onMouseDown={(ev) => ev.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-head">
          <h2>Record settlement</h2>
          <button type="button" onClick={onClose}>×</button>
        </div>
        <p className="sheet-copy">Record money you paid to settle your balance.</p>
        <form onSubmit={(ev) => { void save(ev); }}>
          <label>Paid to
            <select name="to">
              <option value="">Select member</option>
              {others.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <label>Amount<input name="amount" type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="0" required /></label>
          <label>Date<input name="date" type="date" defaultValue={todayStr()} /></label>
          <button className="sheet-submit" type="submit" disabled={saving}>{saving ? "Saving…" : "Save settlement"}</button>
        </form>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// House — Add Member sheet (owner only)
// Shows the house code so the owner can share it; new members join via
// join_house_by_code or a house invite link — no PIN required.
// ---------------------------------------------------------------------------
function HouseMemberSheet({ houseCode, onClose, flash }: {
  houseCode: string;
  onClose: () => void;
  flash: (msg: string) => void;
}) {
  const copied = () => {
    void navigator.clipboard.writeText(houseCode).then(() => flash(`Code ${houseCode} copied to clipboard.`));
  };

  return (
    <div className="sheet-backdrop" onMouseDown={onClose}>
      <section className="sheet" onMouseDown={(ev) => ev.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-head">
          <h2>Invite members</h2>
          <button type="button" onClick={onClose}>×</button>
        </div>
        <p className="sheet-copy">Share the house code with anyone you want to invite. They can join from the NestSplit app using this code.</p>
        <div style={{ textAlign: "center", margin: "22px 0 8px" }}>
          <p style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", letterSpacing: "0.1em", marginBottom: 10 }}>HOUSE CODE</p>
          <p style={{ fontSize: 28, fontWeight: 900, letterSpacing: "0.08em", color: "var(--green)" }}>{houseCode}</p>
        </div>
        <button className="sheet-submit" type="button" onClick={copied}>Copy code</button>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// House — Deactivate member (owner only, via RPC)
// ---------------------------------------------------------------------------
async function deactivateMember(
  houseId: string,
  memberId: string,
  reload: () => Promise<void>,
  flash: (msg: string) => void,
) {
  const client = getSupabaseBrowserClient();
  if (!client) return;
  const { error } = await client.rpc("set_house_member_active", {
    input_house_id:  houseId,
    input_member_id: memberId,
    input_active:    false,
  });
  if (error) { flash(error.message); return; }
  flash("Member deactivated.");
  await reload();
}
