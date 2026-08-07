"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient, signInWithGoogle } from "@/app/lib/supabase";

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

  if (booting) return <main className="app-stage"><section className="phone-shell splash" aria-label="Loading"><div className="logo">N</div></section></main>;
  if (!user) return <Welcome error={error} onPersonal={() => authenticate("personal")} onHouse={() => authenticate("house")} />;

  const activeHouse = workspace.startsWith("house:") ? houses.find((h) => h.id === workspace.slice(6)) : null;

  if (workspace === "selector") return (
    <>
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
    </>
  );

  // Authenticated workspace — Personal or House
  return (
    <main className="app-stage">
      <section className="phone-shell">
        {workspace === "personal" ? (
          <PersonalApp user={user} onSwitchSpace={() => selectWorkspace("selector")} onLogout={logout} />
        ) : (
          <>
            <header className="app-header">
              <button className="space-title" onClick={() => selectWorkspace("selector")}>
                <small>HOUSE</small>
                <b>🏠 {activeHouse?.name ?? "House"} <i>⌄</i></b>
              </button>
              <button className="bell" onClick={logout} aria-label="Log out">↪</button>
            </header>
            <div className="content">
              <HouseHome house={activeHouse!} />
            </div>
          </>
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
// House placeholder (House UI is separate feature)
// ---------------------------------------------------------------------------
function HouseHome({ house }: { house: House }) {
  return (
    <>
      <p className="eyebrow">HOUSE SPACE</p>
      <h1 className="welcome-title">{house.name}</h1>
      <section className="hero-card">
        <p>SHARED SPACE</p>
        <strong>Ready to split</strong>
        <span>Invite members with code {house.house_code}</span>
      </section>
      <div className="section-title"><h2>House dashboard</h2></div>
      <p className="empty">This House is ready for shared expenses.</p>
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
