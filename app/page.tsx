"use client";

import { useEffect, useState } from "react";

type Role = "owner" | "member";
type Member = { id: string; name: string; mobile: string; role: Role; active: boolean };
type Expense = { id: string; title: string; amount: number; category: string; date: string; paidBy: string; createdBy: string };
type Settlement = { id: string; from: string; to: string; amount: number; date: string };
type House = { id: string; name: string; pin: string; ownerId: string; members: Member[]; expenses: Expense[]; settlements: Settlement[] };
type Session = { houseId: string; memberId: string };

const HOUSES_KEY = "nestsplit-houses-v2";
const SESSION_KEY = "nestsplit-session-v2";
const currency = (amount: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount || 0);
const uid = () => typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const houseCode = () => `NS-${Math.random().toString(36).slice(2, 6).toUpperCase()}${Math.floor(10 + Math.random() * 90)}`;
const today = () => new Date().toISOString().slice(0, 10);

function getBalances(house: House) {
  const active = house.members.filter((member) => member.active);
  const totals = Object.fromEntries(active.map((member) => [member.id, 0]));
  house.expenses.forEach((expense) => {
    const share = active.length ? expense.amount / active.length : 0;
    totals[expense.paidBy] = (totals[expense.paidBy] || 0) + expense.amount;
    active.forEach((member) => { totals[member.id] -= share; });
  });
  house.settlements.forEach((settlement) => {
    totals[settlement.from] = (totals[settlement.from] || 0) + settlement.amount;
    totals[settlement.to] = (totals[settlement.to] || 0) - settlement.amount;
  });
  return active.map((member) => ({ ...member, balance: Number((totals[member.id] || 0).toFixed(2)) }));
}

export default function NestSplit() {
  const [houses, setHouses] = useState<House[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [authMode, setAuthMode] = useState<"welcome" | "register" | "join" | "login">("welcome");
  const [screen, setScreen] = useState<"home" | "activity" | "insights" | "settings">("home");
  const [sheet, setSheet] = useState<"expense" | "member" | "settlement" | "pin" | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    try {
      // The first client render restores the persisted device session.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHouses(JSON.parse(localStorage.getItem(HOUSES_KEY) || "[]"));
      setSession(JSON.parse(localStorage.getItem(SESSION_KEY) || "null"));
    } catch { localStorage.removeItem(HOUSES_KEY); localStorage.removeItem(SESSION_KEY); }
    setHydrated(true);
  }, []);
  useEffect(() => { if (hydrated) localStorage.setItem(HOUSES_KEY, JSON.stringify(houses)); }, [houses, hydrated]);
  useEffect(() => { if (hydrated) { if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session)); else localStorage.removeItem(SESSION_KEY); } }, [session, hydrated]);

  const house = houses.find((entry) => entry.id === session?.houseId) || null;
  const member = house?.members.find((entry) => entry.id === session?.memberId) || null;
  const balances = house ? getBalances(house) : [];
  const myBalance = balances.find((entry) => entry.id === member?.id)?.balance || 0;
  const activeMembers = house?.members.filter((entry) => entry.active) || [];
  const monthExpenses = house?.expenses.filter((entry) => entry.date.slice(0, 7) === today().slice(0, 7)) || [];
  const monthTotal = monthExpenses.reduce((sum, entry) => sum + entry.amount, 0);
  const updateHouse = (next: House) => setHouses((current) => current.map((entry) => entry.id === next.id ? next : entry));
  const flash = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(""), 2400); };

  if (!hydrated) return <main className="app-stage"><div className="phone-shell splash"><div className="logo">N</div><p>NestSplit</p></div></main>;
  if (!house || !member || !member.active) return <Auth authMode={authMode} setAuthMode={setAuthMode} houses={houses} setHouses={setHouses} setSession={setSession} flash={flash} />;

  const isOwner = member.role === "owner";
  const currentMonthName = new Date().toLocaleDateString("en-IN", { month: "long" });
  const recent = [...house.expenses].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  const categoryTotals = Object.entries(house.expenses.reduce<Record<string, number>>((acc, entry) => ({ ...acc, [entry.category]: (acc[entry.category] || 0) + entry.amount }), {})).sort((a, b) => b[1] - a[1]);

  return <main className="app-stage"><div className="phone-shell">
    <header className="app-header"><div><p className="eyebrow">{house.name}</p><h1>{screen === "home" ? "Good day, " + member.name.split(" ")[0] : screen[0].toUpperCase() + screen.slice(1)}</h1></div><button className="avatar" onClick={() => setScreen("settings")}>{member.name.slice(0, 1).toUpperCase()}</button></header>
    <div className="content">
      {screen === "home" && <>
        <section className="hero-card"><p>HOUSEHOLD EXPENSE</p><strong>{currency(monthTotal)}</strong><span>{currentMonthName} · {activeMembers.length} members</span><div className="balance-chip">{myBalance >= 0 ? "You get back" : "You owe"} <b>{currency(Math.abs(myBalance))}</b></div></section>
        <div className="section-title"><h2>Quick add</h2><button onClick={() => setSheet("expense")}>Add expense</button></div>
        <button className="quick-add" onClick={() => setSheet("expense")}><span>＋</span><div><b>Record an expense</b><small>Split equally with the house</small></div><i>›</i></button>
        <div className="section-title"><h2>Recent expenses</h2><button onClick={() => setScreen("activity")}>See all</button></div>
        <ExpenseList expenses={recent} house={house} />
        <div className="section-title"><h2>This month</h2></div><section className="summary-card"><div><small>Daily average</small><b>{currency(monthTotal / Math.max(new Date().getDate(), 1))}</b></div><div><small>Top category</small><b>{categoryTotals[0]?.[0] || "—"}</b></div></section>
        <button className="insight-card" onClick={() => setScreen("insights")}><span>✦</span><div><small>SMALL INSIGHT</small><b>{categoryTotals[0] ? `${categoryTotals[0][0]} is your largest shared expense.` : "Add an expense to unlock insights."}</b></div><i>›</i></button>
      </>}
      {screen === "activity" && <><p className="screen-copy">Every shared expense and settlement in one place.</p><ExpenseList expenses={[...house.expenses].sort((a,b) => b.date.localeCompare(a.date))} house={house} full /><button className="secondary-action" onClick={() => setSheet("settlement")}>Record a settlement</button></>}
      {screen === "insights" && <><section className="insight-hero"><small>MONTHLY SUMMARY</small><strong>{currency(monthTotal)}</strong><span>{monthExpenses.length} expenses this month</span></section><div className="section-title"><h2>Spend by category</h2></div><section className="chart-card">{categoryTotals.length ? categoryTotals.map(([name, value]) => <div className="bar-row" key={name}><div><span>{name}</span><b>{currency(value)}</b></div><i><em style={{ width: `${Math.max(10, value / categoryTotals[0][1] * 100)}%` }} /></i></div>) : <p className="empty">Your categories will appear here.</p>}</section><div className="section-title"><h2>Balances</h2></div><BalanceList balances={balances} /></>}
      {screen === "settings" && <><section className="profile-card"><div className="profile-avatar">{member.name.slice(0, 1)}</div><div><b>{member.name}</b><small>{member.mobile} · {isOwner ? "Owner" : "Member"}</small></div></section>{isOwner && <section className="members-card"><div><b>Members</b><button onClick={() => setSheet("member")}>Add</button></div>{activeMembers.map((entry) => <p key={entry.id}><span>{entry.name}<small>{entry.role === "owner" ? "Owner" : entry.mobile}</small></span>{entry.role === "member" && <button onClick={() => updateHouse({ ...house, members: house.members.map((item) => item.id === entry.id ? { ...item, active: false } : item) })}>Deactivate</button>}</p>)}</section>}<div className="setting-group"><small>HOUSE</small>{isOwner && <button onClick={() => flash(`House ID: ${house.id}`)}><span>⌁</span>House ID <b>View</b></button>}{isOwner && <button onClick={() => flash(`House PIN: ${house.pin}`)}><span>⌁</span>House PIN <b>View</b></button>}{isOwner && <button onClick={() => setSheet("member")}><span>＋</span>Manage members <b>{activeMembers.length}</b></button>}{isOwner && <button onClick={() => setSheet("pin")}><span>⌘</span>Reset House PIN <b>›</b></button>}</div><div className="setting-group"><small>ACCOUNT</small><button onClick={() => { setSession(null); setAuthMode("welcome"); }}><span>↪</span>Log out <b>›</b></button></div></>}
    </div>
    <button className="fab" onClick={() => setSheet("expense")} aria-label="Add expense">＋</button>
    <nav className="bottom-nav">{([ ["home", "⌂", "Home"], ["activity", "◷", "Activity"], ["add", "＋", ""], ["insights", "◔", "Insights"], ["settings", "⚙", "Settings"] ] as const).map(([key, icon, label]) => <button key={key} className={screen === key ? "active" : key === "add" ? "nav-add" : ""} onClick={() => key === "add" ? setSheet("expense") : setScreen(key as typeof screen)}><i>{icon}</i>{label && <span>{label}</span>}</button>)}</nav>
    {sheet && <Sheet type={sheet} house={house} member={member} isOwner={isOwner} updateHouse={updateHouse} close={() => setSheet(null)} flash={flash} />}
    {notice && <div className="toast">{notice}</div>}
  </div></main>;
}

function Auth({ authMode, setAuthMode, houses, setHouses, setSession, flash }: { authMode: string; setAuthMode: (mode: "welcome" | "register" | "join" | "login") => void; houses: House[]; setHouses: (value: House[]) => void; setSession: (value: Session) => void; flash: (value: string) => void }) {
  const privateSubmit = (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); const pin = String(form.get("pin") || ""); if (!/^\d{4,6}$/.test(pin)) return flash("Enter a 4–6 digit House PIN."); if (authMode === "register") { const name = String(form.get("name") || "").trim(); const mobile = String(form.get("mobile") || "").replace(/\D/g, ""); if (!name || mobile.length < 10) return flash("Enter your name and a valid mobile number."); const owner: Member = { id: uid(), name, mobile, role: "owner", active: true }; const house: House = { id: houseCode(), name: String(form.get("houseName") || "").trim() || "Our Home", pin, ownerId: owner.id, members: [owner], expenses: [], settlements: [] }; setHouses([...houses, house]); setSession({ houseId: house.id, memberId: owner.id }); return; } const lastFour = String(form.get("lastFour") || "").replace(/\D/g, ""); const matches = houses.flatMap((house) => house.pin === pin ? house.members.filter((entry) => entry.active && entry.mobile.endsWith(lastFour)).map((entry) => ({ house, member: entry })) : []); if (lastFour.length !== 4 || matches.length !== 1) return flash("Check your last 4 digits and House PIN."); setSession({ houseId: matches[0].house.id, memberId: matches[0].member.id }); };
  const registering = authMode === "register";
  if (true) return <main className="app-stage"><div className="phone-shell auth-shell">{authMode === "welcome" ? <><div className="auth-art"><div className="logo">N</div><span>Shared living, simplified.</span></div><div className="auth-copy"><p className="eyebrow">NESTSPLIT</p><h1>Money at home,<br />made simple.</h1><p>Share expenses, settle up, and keep your home in sync.</p></div><div className="auth-actions"><button onClick={() => setAuthMode("register")}>Create a house</button><button className="outline" onClick={() => setAuthMode("login")}>Log in to your house</button></div></> : <form className="auth-form" onSubmit={privateSubmit}><button type="button" className="back" onClick={() => setAuthMode("welcome")}>Back</button><div className="logo small">N</div><h1>{registering ? "Create your house" : "Welcome back"}</h1><p>{registering ? "You’ll be the owner and can add members afterwards." : "Enter your private mobile ID and House PIN."}</p>{registering && <><label>Full name<input name="name" placeholder="Your name" /></label><label>Mobile number<input name="mobile" inputMode="numeric" placeholder="10-digit mobile number" /></label><label>House name<input name="houseName" placeholder="e.g. Palm House" /></label></>}{!registering && <label>Mobile number ID<input name="lastFour" inputMode="numeric" maxLength={4} placeholder="Last 4 digits" /></label>}<label>House PIN<input name="pin" type="password" inputMode="numeric" maxLength={6} placeholder="4–6 digits" /></label><button type="submit">{registering ? "Create house" : "Log in"}</button></form>}</div></main>;
  const submit = (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); const name = String(form.get("name") || "").trim(); const mobile = String(form.get("mobile") || "").replace(/\D/g, ""); const id = String(form.get("houseId") || "").trim().toUpperCase(); const pin = String(form.get("pin") || ""); if (!name || mobile.length < 10 || !/^\d{4,6}$/.test(pin)) return flash("Enter a name, valid mobile number, and 4–6 digit PIN."); if (authMode === "register") { if (houses.some((house) => house.members.some((member) => member.mobile === mobile))) return flash("This mobile number is already registered."); const owner: Member = { id: uid(), name, mobile, role: "owner", active: true }; const house: House = { id: houseCode(), name: String(form.get("houseName") || "").trim() || "Our Home", pin, ownerId: owner.id, members: [owner], expenses: [], settlements: [] }; setHouses([...houses, house]); setSession({ houseId: house.id, memberId: owner.id }); flash(`House created · ID ${house.id} · PIN ${pin}`); return; } const house = houses.find((entry) => entry.id === id && entry.pin === pin); if (!house) return flash("Check the House ID and House PIN."); const matched = house.members.find((entry) => entry.mobile === mobile && entry.active); if (!matched) return flash("This mobile number is not a member of this house."); setSession({ houseId: house.id, memberId: matched.id }); };
  return <main className="app-stage"><div className="phone-shell auth-shell">{authMode === "welcome" ? <><div className="auth-art"><div className="logo">N</div><span>Shared living, simplified.</span></div><div className="auth-copy"><p className="eyebrow">NESTSPLIT</p><h1>Money at home,<br />made simple.</h1><p>Share expenses, settle up, and keep your home in sync.</p></div><div className="auth-actions"><button onClick={() => setAuthMode("register")}>Create a house</button><button className="outline" onClick={() => setAuthMode("join")}>Join a house</button><button className="text-button" onClick={() => setAuthMode("login")}>Already a member? Log in</button></div></> : <form className="auth-form" onSubmit={submit}><button type="button" className="back" onClick={() => setAuthMode("welcome")}>‹ Back</button><div className="logo small">N</div><h1>{authMode === "register" ? "Create your house" : authMode === "join" ? "Join your house" : "Welcome back"}</h1><p>{authMode === "register" ? "You’ll be the owner and can add members afterwards." : "Use the details shared by your house owner."}</p><label>Full name<input name="name" placeholder="Your name" autoComplete="name" /></label><label>Mobile number<input name="mobile" inputMode="numeric" placeholder="10-digit mobile number" autoComplete="tel" /></label>{authMode === "register" && <label>House name<input name="houseName" placeholder="e.g. Palm House" /></label>}{authMode !== "register" && <label>House ID<input name="houseId" placeholder="e.g. NS-ABCD12" autoCapitalize="characters" /></label>}<label>House PIN<input name="pin" type="password" inputMode="numeric" maxLength={6} placeholder="4–6 digits" /></label><button type="submit">{authMode === "register" ? "Create house" : authMode === "join" ? "Join house" : "Log in"}</button></form>}</div></main>;
}

function ExpenseList({ expenses, house, full = false }: { expenses: Expense[]; house: House; full?: boolean }) { if (!expenses.length) return <div className="empty">No expenses yet. Add the first one in a few taps.</div>; return <div className={full ? "expense-list full" : "expense-list"}>{expenses.map((expense) => <div className="expense-row" key={expense.id}><div className="expense-icon">{expense.category.slice(0, 1)}</div><div><b>{expense.title}</b><small>{expense.category} · Paid by {house.members.find((entry) => entry.id === expense.paidBy)?.name || "Member"}</small></div><div><b>{currency(expense.amount)}</b><small>{new Date(expense.date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</small></div></div>)}</div>; }
function BalanceList({ balances }: { balances: ReturnType<typeof getBalances> }) { return <div className="balance-list">{balances.map((entry) => <div key={entry.id}><div className="mini-avatar">{entry.name[0]}</div><span>{entry.name}</span><b className={entry.balance >= 0 ? "positive" : "negative"}>{entry.balance >= 0 ? "gets " : "owes "}{currency(Math.abs(entry.balance))}</b></div>)}</div>; }
function Sheet({ type, house, member, isOwner, updateHouse, close, flash }: { type: "expense" | "member" | "settlement" | "pin"; house: House; member: Member; isOwner: boolean; updateHouse: (house: House) => void; close: () => void; flash: (value: string) => void }) {
  const active = house.members.filter((entry) => entry.active); const save = (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); if (type === "expense") { const amount = Number(form.get("amount")); const title = String(form.get("title") || "").trim(); if (!title || amount <= 0) return flash("Add an expense name and amount."); updateHouse({ ...house, expenses: [{ id: uid(), title, amount, category: String(form.get("category") || "Other"), date: String(form.get("date") || today()), paidBy: String(form.get("paidBy") || member.id), createdBy: member.id }, ...house.expenses] }); close(); } if (type === "member" && isOwner) { const name = String(form.get("name") || "").trim(); const mobile = String(form.get("mobile") || "").replace(/\D/g, ""); if (!name || mobile.length < 10) return flash("Enter the member name and mobile number."); if (house.members.some((entry) => entry.mobile === mobile)) return flash("That mobile number is already in this house."); updateHouse({ ...house, members: [...house.members, { id: uid(), name, mobile, role: "member", active: true }] }); close(); } if (type === "settlement") { const amount = Number(form.get("amount")); const to = String(form.get("to") || ""); if (!to || amount <= 0) return flash("Choose who you paid and the amount."); updateHouse({ ...house, settlements: [{ id: uid(), from: member.id, to, amount, date: today() }, ...house.settlements] }); close(); } if (type === "pin" && isOwner) { const pin = String(form.get("pin") || ""); if (!/^\d{4,6}$/.test(pin)) return flash("House PIN must be 4–6 digits."); updateHouse({ ...house, pin }); close(); flash("House PIN updated."); } };
  return <div className="sheet-backdrop" onMouseDown={close}><section className="sheet" onMouseDown={(event) => event.stopPropagation()}><div className="sheet-handle" /><div className="sheet-head"><h2>{type === "expense" ? "Add expense" : type === "member" ? "Add member" : type === "settlement" ? "Record settlement" : "Reset House PIN"}</h2><button onClick={close}>×</button></div><form onSubmit={save}>{type === "expense" && <><label>What was it?<input name="title" placeholder="e.g. Groceries" autoFocus /></label><label>Amount<input name="amount" type="number" inputMode="decimal" placeholder="0" /></label><label>Category<select name="category"><option>Food</option><option>Rent</option><option>Bills</option><option>Transport</option><option>Other</option></select></label><label>Paid by<select name="paidBy" defaultValue={member.id}>{active.map((entry) => <option value={entry.id} key={entry.id}>{entry.name}</option>)}</select></label><label>Date<input name="date" type="date" defaultValue={today()} /></label></>}{type === "member" && <><p className="sheet-copy">They can log in after you add their exact mobile number.</p><label>Member name<input name="name" autoFocus placeholder="Full name" /></label><label>Mobile number<input name="mobile" inputMode="numeric" placeholder="10-digit mobile number" /></label></>}{type === "settlement" && <><p className="sheet-copy">Record money you paid to settle your balance.</p><label>Paid to<select name="to"><option value="">Select member</option>{active.filter((entry) => entry.id !== member.id).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label><label>Amount<input name="amount" type="number" inputMode="decimal" placeholder="0" /></label></>}{type === "pin" && <label>New House PIN<input name="pin" type="password" inputMode="numeric" maxLength={6} autoFocus placeholder="4–6 digits" /></label>}<button className="sheet-submit" type="submit">{type === "expense" ? "Add expense" : type === "member" ? "Add member" : type === "settlement" ? "Save settlement" : "Update PIN"}</button></form></section></div>;
}
