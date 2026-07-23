"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Person = "me" | "partner";
type Scope = Person | "shared_housing" | "shared_other";
type Screen = "overview" | "me" | "partner" | "shared" | "audit" | "settings";

type Expense = {
  id: number;
  title: string;
  amount: number;
  scope: Scope;
  category: string;
  notes: string;
  dueDate: string;
  recurring: boolean;
  paid: boolean;
  createdAt: string;
  updatedAt: string;
};

type AuditEntry = {
  id: number;
  timestamp: string;
  actionType: string;
  entityType: string;
  entityId: string;
  budgetScope: string;
  summary: string;
  beforeValue: unknown;
  afterValue: unknown;
};

type BudgetData = {
  incomes: Record<Person, number>;
  expenses: Expense[];
  savings: Record<Person, number>;
  planNames: Record<Person, string>;
  notes: { id: number; scope: string; body: string; updatedAt: string }[];
  audit: AuditEntry[];
  totals: {
    housing: number;
    other: number;
    personal: Record<Person, number>;
    committed: Record<Person, number>;
    remainingBeforeSavings: Record<Person, number>;
    disposable: Record<Person, number>;
  };
  split: {
    combinedIncome: number;
    incomePercentages: Record<Person, number>;
    housingShares: Record<Person, number>;
    otherShares: Record<Person, number>;
    combinedShared: number;
    zeroIncome: boolean;
  };
};

const baseNav: { id: Screen; label: string; short: string; icon: string }[] = [
  { id: "overview", label: "Overview", short: "Home", icon: "⌂" },
  { id: "me", label: "My budget", short: "Mine", icon: "●" },
  { id: "partner", label: "Partner budget", short: "Partner", icon: "●" },
  { id: "shared", label: "Shared household", short: "Shared", icon: "⌁" },
  { id: "audit", label: "Audit log", short: "History", icon: "↺" },
  { id: "settings", label: "Settings", short: "More", icon: "⚙" },
];

const categories = [
  "Housing", "Groceries", "Utilities", "Internet", "Council tax", "Insurance",
  "Subscriptions", "Childcare", "Transport", "Phone", "Wellbeing", "Leisure", "Other",
];

const blankExpense = (): Omit<Expense, "id" | "createdAt" | "updatedAt"> => ({
  title: "",
  amount: 0,
  scope: "shared_other",
  category: "Groceries",
  notes: "",
  dueDate: new Date().toISOString().slice(0, 10),
  recurring: true,
  paid: false,
});

const currency = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const money = (n: number) => currency.format(n);
const percent = (n: number) => `${Math.round(n * 100)}%`;
const scopeName = (scope: string, planNames?: Record<Person, string>) =>
  ({ me: planNames?.me ?? "My budget", partner: planNames?.partner ?? "Partner budget", shared_housing: "Housing", shared_other: "Household", shared: "Shared" })[scope] ?? scope;
const actionName = (action: string) => action.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());

function Icon({ name }: { name: string }) {
  return <span className="nav-symbol" aria-hidden="true">{name}</span>;
}

function Progress({ value, tone = "green" }: { value: number; tone?: "green" | "blue" | "gold" }) {
  return <div className="progress" aria-hidden="true"><span className={tone} style={{ width: `${Math.max(2, Math.min(value, 100))}%` }} /></div>;
}

function MetricCard({ label, value, meta, tone = "green" }: { label: string; value: string; meta?: string; tone?: "green" | "blue" | "gold" }) {
  return (
    <article className="metric-card">
      <span className={`metric-mark ${tone}`} />
      <p>{label}</p>
      <strong>{value}</strong>
      {meta && <small>{meta}</small>}
    </article>
  );
}

export default function BudgetApp() {
  const [data, setData] = useState<BudgetData | null>(null);
  const [screen, setScreen] = useState<Screen>("overview");
  const [month, setMonth] = useState("July 2026");
  const [modal, setModal] = useState<"expense" | "income" | "savings" | "plan" | "note" | null>(null);
  const [draft, setDraft] = useState<Partial<Expense>>(blankExpense());
  const [person, setPerson] = useState<Person>("me");
  const [amount, setAmount] = useState(0);
  const [planName, setPlanName] = useState("");
  const [noteText, setNoteText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [auditQuery, setAuditQuery] = useState("");
  const [auditScope, setAuditScope] = useState("all");
  const [auditAction, setAuditAction] = useState("all");
  const [auditDate, setAuditDate] = useState("");
  const [dark, setDark] = useState(false);

  const load = async () => {
    try {
      const response = await fetch("/api/budget", { cache: "no-store" });
      const payload = await response.json() as BudgetData & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not load the budget.");
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the budget.");
    }
  };

  useEffect(() => {
    const task = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(task);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const mutate = async (method: "POST" | "PATCH" | "DELETE", body?: unknown, query = "") => {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/budget${query}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const payload = await response.json() as BudgetData & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not save your change.");
      setData(payload);
      setModal(null);
      setToast("Saved — totals and split updated");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your change.");
    } finally {
      setSaving(false);
    }
  };

  const openExpense = (scope: Scope, expense?: Expense) => {
    setDraft(expense ? { ...expense } : { ...blankExpense(), scope });
    setModal("expense");
    setError("");
  };

  const openMoney = (kind: "income" | "savings", who: Person) => {
    if (!data) return;
    setPerson(who);
    setAmount(kind === "income" ? data.incomes[who] : data.savings[who]);
    setModal(kind);
    setError("");
  };

  const openPlanName = (who: Person) => {
    if (!data) return;
    setPerson(who);
    setPlanName(data.planNames[who]);
    setModal("plan");
    setError("");
  };

  const submitExpense = (event: FormEvent) => {
    event.preventDefault();
    const body = { kind: "expense", ...draft, amount: Number(draft.amount) };
    void mutate(draft.id ? "PATCH" : "POST", body);
  };

  const filteredAudit = useMemo(() => {
    if (!data) return [];
    const term = auditQuery.trim().toLowerCase();
    return data.audit.filter((item) => {
      const matchesTerm = !term || `${item.summary} ${item.actionType} ${item.budgetScope}`.toLowerCase().includes(term);
      const matchesScope = auditScope === "all" || item.budgetScope === auditScope;
      const matchesAction = auditAction === "all" || item.actionType === auditAction;
      const matchesDate = !auditDate || item.timestamp.slice(0, 10) === auditDate;
      return matchesTerm && matchesScope && matchesAction && matchesDate;
    });
  }, [data, auditQuery, auditScope, auditAction, auditDate]);

  if (!data) {
    return (
      <main className="loading-shell">
        <div className="brand-mark large">HB</div>
        <h1>Household Budget Planner</h1>
        <p>{error || "Opening your household budget…"}</p>
        {error && <button className="primary-button" onClick={() => void load()}>Try again</button>}
      </main>
    );
  }

  const nav = baseNav.map((item) => item.id === "me"
    ? { ...item, label: data.planNames.me, short: data.planNames.me }
    : item.id === "partner"
      ? { ...item, label: data.planNames.partner, short: data.planNames.partner }
      : item);
  const screenTitle = nav.find((item) => item.id === screen)?.label ?? "Overview";
  const paid = data.expenses.filter((item) => item.paid).reduce((sum, item) => sum + item.amount, 0);
  const totalCommitted = data.totals.committed.me + data.totals.committed.partner;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">HB</div>
          <div><strong>Household</strong><span>Budget Planner</span></div>
        </div>
        <nav aria-label="Main navigation">
          {nav.map((item) => (
            <button key={item.id} className={screen === item.id ? "active" : ""} onClick={() => setScreen(item.id)}>
              <Icon name={item.icon} /><span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-rule">
          <span>Split rules</span>
          <strong>Housing</strong><b>75 / 25</b>
          <strong>Household</strong><b>{percent(data.split.incomePercentages.me)} / {percent(data.split.incomePercentages.partner)}</b>
        </div>
        <div className="account">
          <span>HB</span>
          <div><strong>Our household</strong><small>Synced securely</small></div>
          <i>•••</i>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="mobile-brand"><div className="brand-mark">HB</div><strong>{screenTitle}</strong></div>
          <div className="top-actions">
            <select aria-label="Budget month" value={month} onChange={(e) => setMonth(e.target.value)}>
              <option>July 2026</option><option>August 2026</option><option>September 2026</option>
            </select>
            <button className="icon-button" onClick={() => setDark(!dark)} aria-label="Toggle colour theme">{dark ? "☀" : "☾"}</button>
            <button className="primary-button" onClick={() => openExpense(screen === "me" ? "me" : screen === "partner" ? "partner" : "shared_other")}>
              <span>＋</span> Add expense
            </button>
          </div>
        </header>

        <section className="content">
          {screen === "overview" && (
            <Overview data={data} paid={paid} totalCommitted={totalCommitted} openExpense={openExpense} setScreen={setScreen} />
          )}
          {(screen === "me" || screen === "partner") && (
            <PersonalBudget
              data={data}
              person={screen}
              openExpense={openExpense}
              openMoney={openMoney}
              onToggle={(expense) => void mutate("PATCH", { kind: "expense", ...expense, paid: !expense.paid })}
              onEdit={(expense) => openExpense(expense.scope, expense)}
            />
          )}
          {screen === "shared" && (
            <SharedBudget
              data={data}
              openExpense={openExpense}
              onToggle={(expense) => void mutate("PATCH", { kind: "expense", ...expense, paid: !expense.paid })}
              onEdit={(expense) => openExpense(expense.scope, expense)}
            />
          )}
          {screen === "audit" && (
            <AuditLog
              entries={filteredAudit}
              planNames={data.planNames}
              query={auditQuery}
              setQuery={setAuditQuery}
              scope={auditScope}
              setScope={setAuditScope}
              action={auditAction}
              setAction={setAuditAction}
              date={auditDate}
              setDate={setAuditDate}
            />
          )}
          {screen === "settings" && (
            <Settings
              data={data}
              dark={dark}
              setDark={setDark}
              openIncome={(who) => openMoney("income", who)}
              openSavings={(who) => openMoney("savings", who)}
              openPlanName={openPlanName}
              openNote={() => { setNoteText(""); setModal("note"); }}
              removeNote={(id) => void mutate("DELETE", undefined, `?kind=note&id=${id}`)}
            />
          )}
        </section>
      </main>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        {nav.slice(0, 5).map((item) => (
          <button key={item.id} className={screen === item.id ? "active" : ""} onClick={() => setScreen(item.id)}>
            <Icon name={item.icon} /><span>{item.short}</span>
          </button>
        ))}
      </nav>

      {modal && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.currentTarget === e.target) setModal(null); }}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <button className="modal-close" onClick={() => setModal(null)} aria-label="Close">×</button>
            {modal === "expense" && (
              <form onSubmit={submitExpense}>
                <p className="eyebrow">Budget item</p>
                <h2 id="modal-title">{draft.id ? "Edit expense" : "Add an expense"}</h2>
                <div className="form-grid">
                  <label className="span-2">Title<input autoFocus required value={draft.title ?? ""} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. Water bill" /></label>
                  <label>Amount (£)<input required type="number" min="0" step="0.01" value={draft.amount ?? 0} onChange={(e) => setDraft({ ...draft, amount: Number(e.target.value) })} /></label>
                  <label>Budget<select value={draft.scope} onChange={(e) => setDraft({ ...draft, scope: e.target.value as Scope })}>
                    <option value="me">{data.planNames.me}</option><option value="partner">{data.planNames.partner}</option>
                    <option value="shared_housing">Shared housing (75/25)</option><option value="shared_other">Shared household (income split)</option>
                  </select></label>
                  <label>Category<select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
                    {categories.map((category) => <option key={category}>{category}</option>)}
                  </select></label>
                  <label>Due date<input required type="date" value={draft.dueDate ?? ""} onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })} /></label>
                  <label className="span-2">Description or notes<textarea value={draft.notes ?? ""} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Optional context" /></label>
                  <label className="toggle-line"><input type="checkbox" checked={draft.recurring ?? false} onChange={(e) => setDraft({ ...draft, recurring: e.target.checked })} /><span>Recurring expense</span></label>
                  <label className="toggle-line"><input type="checkbox" checked={draft.paid ?? false} onChange={(e) => setDraft({ ...draft, paid: e.target.checked })} /><span>Already paid</span></label>
                </div>
                {error && <p className="form-error">{error}</p>}
                <div className="modal-actions">
                  {draft.id && <button type="button" className="danger-button" onClick={() => void mutate("DELETE", undefined, `?kind=expense&id=${draft.id}`)}>Delete</button>}
                  <button type="button" className="text-button" onClick={() => setModal(null)}>Cancel</button>
                  <button className="primary-button" disabled={saving}>{saving ? "Saving…" : "Save expense"}</button>
                </div>
              </form>
            )}
            {(modal === "income" || modal === "savings") && (
              <form onSubmit={(e) => { e.preventDefault(); void mutate("PATCH", { kind: modal, person, amount }); }}>
                <p className="eyebrow">{data.planNames[person]}</p>
                <h2 id="modal-title">Update {modal}</h2>
                <label>Monthly amount (£)<input autoFocus type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></label>
                <p className="form-hint">{modal === "income" ? "Changing income immediately recalculates every non-housing shared bill." : "This is deducted after committed spending."}</p>
                {error && <p className="form-error">{error}</p>}
                <div className="modal-actions"><button type="button" className="text-button" onClick={() => setModal(null)}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? "Saving…" : "Save change"}</button></div>
              </form>
            )}
            {modal === "plan" && (
              <form onSubmit={(e) => { e.preventDefault(); void mutate("PATCH", { kind: "plan_name", person, name: planName }); }}>
                <p className="eyebrow">Plan name</p>
                <h2 id="modal-title">Rename {data.planNames[person]}</h2>
                <label>Name<input autoFocus required maxLength={40} value={planName} onChange={(e) => setPlanName(e.target.value)} placeholder="e.g. Alex’s budget" /></label>
                <p className="form-hint">This name will be used in navigation, expenses, summaries and the audit log.</p>
                {error && <p className="form-error">{error}</p>}
                <div className="modal-actions"><button type="button" className="text-button" onClick={() => setModal(null)}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? "Saving…" : "Save name"}</button></div>
              </form>
            )}
            {modal === "note" && (
              <form onSubmit={(e) => { e.preventDefault(); void mutate("POST", { kind: "note", scope: "shared", body: noteText }); }}>
                <p className="eyebrow">Household</p><h2 id="modal-title">Add a note</h2>
                <label>Note<textarea autoFocus required value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="A reminder or context for your household…" /></label>
                {error && <p className="form-error">{error}</p>}
                <div className="modal-actions"><button type="button" className="text-button" onClick={() => setModal(null)}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? "Saving…" : "Add note"}</button></div>
              </form>
            )}
          </div>
        </div>
      )}
      {toast && <div className="toast" role="status">✓ {toast}</div>}
    </div>
  );
}

function Overview({ data, paid, totalCommitted, openExpense, setScreen }: {
  data: BudgetData; paid: number; totalCommitted: number; openExpense: (scope: Scope) => void; setScreen: (screen: Screen) => void;
}) {
  return (
    <>
      <div className="page-heading">
        <div><p className="eyebrow">July plan</p><h1>Your money, made clear.</h1><p>One calm view of what’s coming in, going out, and moving forward.</p></div>
        <div className="sync-pill"><span /> All changes saved</div>
      </div>
      <div className="hero-grid">
        <section className="balance-card">
          <div className="balance-top"><span>Combined monthly income</span><em>100%</em></div>
          <strong>{money(data.split.combinedIncome)}</strong>
          <div className="income-split">
            <button onClick={() => setScreen("me")}><span>{data.planNames.me}</span><b>{money(data.incomes.me)}</b><small>{percent(data.split.incomePercentages.me)} of total income</small></button>
            <button onClick={() => setScreen("partner")}><span>{data.planNames.partner}</span><b>{money(data.incomes.partner)}</b><small>{percent(data.split.incomePercentages.partner)} of total income</small></button>
          </div>
        </section>
        <section className="available-card">
          <p>Left after bills & savings</p>
          <strong>{money(data.totals.disposable.me + data.totals.disposable.partner)}</strong>
          <Progress value={Math.max(0, ((data.totals.disposable.me + data.totals.disposable.partner) / data.split.combinedIncome) * 100)} />
          <div><span><i className="dot me" />{data.planNames.me} <b>{money(data.totals.disposable.me)}</b></span><span><i className="dot partner" />{data.planNames.partner} <b>{money(data.totals.disposable.partner)}</b></span></div>
        </section>
      </div>
      {data.split.zeroIncome && <div className="warning-banner">Add at least one income to calculate the proportional household split. Housing remains fixed at 75/25.</div>}
      <div className="metric-grid">
        <MetricCard label="Shared housing" value={money(data.totals.housing)} meta={`${data.planNames.me} ${money(data.split.housingShares.me)} · 75%`} tone="blue" />
        <MetricCard label="Household bills" value={money(data.totals.other)} meta={`Income split ${percent(data.split.incomePercentages.me)} / ${percent(data.split.incomePercentages.partner)}`} tone="gold" />
        <MetricCard label="Planned savings" value={money(data.savings.me + data.savings.partner)} meta={`${data.planNames.me} ${money(data.savings.me)} · ${data.planNames.partner} ${money(data.savings.partner)}`} />
        <MetricCard label="Paid so far" value={money(paid)} meta={`${money(Math.max(0, totalCommitted - paid))} still committed`} tone="blue" />
      </div>
      <div className="overview-lower">
        <section className="panel spending-panel">
          <div className="panel-heading"><div><p className="eyebrow">Monthly plan</p><h2>Where the money goes</h2></div><button className="text-button" onClick={() => setScreen("shared")}>View shared budget →</button></div>
          <div className="stacked-bar">
            <span className="housing" style={{ width: `${(data.totals.housing / data.split.combinedIncome) * 100}%` }} />
            <span className="household" style={{ width: `${(data.totals.other / data.split.combinedIncome) * 100}%` }} />
            <span className="personal" style={{ width: `${((data.totals.personal.me + data.totals.personal.partner) / data.split.combinedIncome) * 100}%` }} />
            <span className="savings" style={{ width: `${((data.savings.me + data.savings.partner) / data.split.combinedIncome) * 100}%` }} />
          </div>
          <div className="legend">
            <span><i className="housing" />Housing <b>{money(data.totals.housing)}</b></span>
            <span><i className="household" />Household <b>{money(data.totals.other)}</b></span>
            <span><i className="personal" />Personal <b>{money(data.totals.personal.me + data.totals.personal.partner)}</b></span>
            <span><i className="savings" />Savings <b>{money(data.savings.me + data.savings.partner)}</b></span>
          </div>
        </section>
        <section className="panel rule-panel">
          <p className="eyebrow">Fair by design</p><h2>How splitting works</h2>
          <div><span className="rule-icon">⌂</span><p><strong>Housing stays 75 / 25</strong><small>Your share never changes when income does.</small></p></div>
          <div><span className="rule-icon gold">%</span><p><strong>Everything else follows income</strong><small>Right now that’s {percent(data.split.incomePercentages.me)} / {percent(data.split.incomePercentages.partner)}.</small></p></div>
          <p className="formula">Each share = personal income ÷ combined income × bill</p>
        </section>
      </div>
      <section className="panel recent-panel">
        <div className="panel-heading"><div><p className="eyebrow">Up next</p><h2>Upcoming commitments</h2></div><button className="primary-button small" onClick={() => openExpense("shared_other")}>＋ Add item</button></div>
        <ExpenseTable expenses={data.expenses.filter((e) => !e.paid).slice(0, 5)} data={data} onToggle={() => {}} onEdit={() => setScreen("shared")} compact />
      </section>
    </>
  );
}

function PersonSummary({ data, person }: { data: BudgetData; person: Person }) {
  const income = data.incomes[person];
  const remaining = data.totals.remainingBeforeSavings[person];
  return (
    <section className={`person-hero ${person}`}>
      <div><p>{data.planNames[person]} income</p><strong>{money(income)}</strong><small>{percent(data.split.incomePercentages[person])} of household income</small></div>
      <div className="person-flow">
        <span><small>Committed</small><b>− {money(data.totals.committed[person])}</b></span>
        <i>→</i><span><small>Before savings</small><b>{money(remaining)}</b></span>
        <i>→</i><span><small>Planned savings</small><b>− {money(data.savings[person])}</b></span>
        <i>→</i><span className="final"><small>Disposable</small><b>{money(data.totals.disposable[person])}</b></span>
      </div>
    </section>
  );
}

function PersonalBudget({ data, person, openExpense, openMoney, onToggle, onEdit }: {
  data: BudgetData; person: Person; openExpense: (scope: Scope, expense?: Expense) => void;
  openMoney: (kind: "income" | "savings", person: Person) => void; onToggle: (expense: Expense) => void; onEdit: (expense: Expense) => void;
}) {
  const ownExpenses = data.expenses.filter((expense) => expense.scope === person);
  return (
    <>
      <div className="page-heading"><div><p className="eyebrow">Personal plan</p><h1>{data.planNames[person]}</h1><p>Income, personal spending, shared commitments and savings in one place.</p></div><button className="secondary-button" onClick={() => openMoney("income", person)}>Edit income</button></div>
      <PersonSummary data={data} person={person} />
      <div className="metric-grid four">
        <MetricCard label="Personal bills" value={money(data.totals.personal[person])} meta={`${ownExpenses.length} items`} />
        <MetricCard label="Housing share" value={money(data.split.housingShares[person])} meta={person === "me" ? "Fixed 75%" : "Fixed 25%"} tone="blue" />
        <MetricCard label="Household share" value={money(data.split.otherShares[person])} meta={`${percent(data.split.incomePercentages[person])} by income`} tone="gold" />
        <MetricCard label="Savings" value={money(data.savings[person])} meta="Planned this month" />
      </div>
      <section className="panel">
        <div className="panel-heading"><div><p className="eyebrow">Personal</p><h2>Bills & expenses</h2></div><button className="primary-button small" onClick={() => openExpense(person)}>＋ Add personal expense</button></div>
        <ExpenseTable expenses={ownExpenses} data={data} onToggle={onToggle} onEdit={onEdit} />
      </section>
      <section className="panel savings-panel">
        <div><span className="savings-icon">↗</span><div><p className="eyebrow">Savings plan</p><h2>{money(data.savings[person])} set aside</h2><p>After every committed cost, {money(data.totals.remainingBeforeSavings[person])} remains before savings and {money(data.totals.disposable[person])} is disposable.</p></div></div>
        <button className="secondary-button" onClick={() => openMoney("savings", person)}>Edit savings</button>
      </section>
    </>
  );
}

function SharedBudget({ data, openExpense, onToggle, onEdit }: {
  data: BudgetData; openExpense: (scope: Scope, expense?: Expense) => void; onToggle: (expense: Expense) => void; onEdit: (expense: Expense) => void;
}) {
  const housing = data.expenses.filter((e) => e.scope === "shared_housing");
  const other = data.expenses.filter((e) => e.scope === "shared_other");
  return (
    <>
      <div className="page-heading"><div><p className="eyebrow">Together</p><h1>Shared household</h1><p>Every shared commitment, with a clear and predictable split.</p></div><button className="primary-button" onClick={() => openExpense("shared_other")}>＋ Add shared bill</button></div>
      <section className="split-hero">
        <div><p>Total shared costs</p><strong>{money(data.split.combinedShared)}</strong><small>{housing.length + other.length} bills this month</small></div>
        <div className="split-people">
          <span><i className="avatar me">{data.planNames.me.slice(0, 1).toUpperCase()}</i><small>{data.planNames.me}</small><b>{money(data.split.housingShares.me + data.split.otherShares.me)}</b></span>
          <span><i className="avatar partner">{data.planNames.partner.slice(0, 1).toUpperCase()}</i><small>{data.planNames.partner}</small><b>{money(data.split.housingShares.partner + data.split.otherShares.partner)}</b></span>
        </div>
      </section>
      {data.split.zeroIncome && <div className="warning-banner">Income-based bills are waiting for income. Add at least one salary in Settings; housing is still allocated at 75/25.</div>}
      <div className="shared-rules">
        <article className="rule-card">
          <div className="rule-card-top"><span className="rule-icon">⌂</span><div><p className="eyebrow">Fixed split</p><h2>Housing · 75 / 25</h2></div><strong>{money(data.totals.housing)}</strong></div>
          <div className="split-bar"><span className="me" style={{ width: "75%" }} /><span className="partner" style={{ width: "25%" }} /></div>
          <div className="split-labels"><span>{data.planNames.me} <b>{money(data.split.housingShares.me)}</b></span><span>{data.planNames.partner} <b>{money(data.split.housingShares.partner)}</b></span></div>
          <p>Housing always stays at this fixed split, even if either income changes.</p>
        </article>
        <article className="rule-card">
          <div className="rule-card-top"><span className="rule-icon gold">%</span><div><p className="eyebrow">Income split</p><h2>Household · {percent(data.split.incomePercentages.me)} / {percent(data.split.incomePercentages.partner)}</h2></div><strong>{money(data.totals.other)}</strong></div>
          <div className="split-bar"><span className="me gold" style={{ width: percent(data.split.incomePercentages.me) }} /><span className="partner" style={{ width: percent(data.split.incomePercentages.partner) }} /></div>
          <div className="split-labels"><span>{data.planNames.me} <b>{money(data.split.otherShares.me)}</b></span><span>{data.planNames.partner} <b>{money(data.split.otherShares.partner)}</b></span></div>
          <p>Every non-housing bill uses current income: person income ÷ {money(data.split.combinedIncome)} × bill.</p>
        </article>
      </div>
      <section className="panel"><div className="panel-heading"><div><p className="eyebrow">75 / 25</p><h2>Housing costs</h2></div><button className="secondary-button small" onClick={() => openExpense("shared_housing")}>＋ Add housing</button></div><ExpenseTable expenses={housing} data={data} onToggle={onToggle} onEdit={onEdit} /></section>
      <section className="panel"><div className="panel-heading"><div><p className="eyebrow">By income</p><h2>Household bills</h2></div><button className="secondary-button small" onClick={() => openExpense("shared_other")}>＋ Add household bill</button></div><ExpenseTable expenses={other} data={data} onToggle={onToggle} onEdit={onEdit} /></section>
    </>
  );
}

function ExpenseTable({ expenses, data, onToggle, onEdit, compact = false }: {
  expenses: Expense[]; data: BudgetData; onToggle: (expense: Expense) => void; onEdit: (expense: Expense) => void; compact?: boolean;
}) {
  if (!expenses.length) return <div className="empty-state"><span>✓</span><h3>Nothing here yet</h3><p>Add an expense when you’re ready.</p></div>;
  return (
    <div className="expense-list">
      {expenses.map((expense) => {
        const myShare = expense.scope === "shared_housing" ? expense.amount * 0.75 : expense.scope === "shared_other" ? expense.amount * data.split.incomePercentages.me : expense.scope === "me" ? expense.amount : 0;
        return (
          <article key={expense.id} className={expense.paid ? "paid" : ""}>
            <button className="paid-toggle" onClick={() => onToggle(expense)} aria-label={expense.paid ? `Mark ${expense.title} unpaid` : `Mark ${expense.title} paid`}>{expense.paid ? "✓" : ""}</button>
            <div className="expense-main" onClick={() => onEdit(expense)} role="button" tabIndex={0}>
              <span className={`category-icon c-${expense.category.toLowerCase().replaceAll(" ", "-")}`}>{expense.title.slice(0, 1)}</span>
              <div><strong>{expense.title}</strong><small>{expense.category} · {expense.recurring ? "Recurring" : "One-off"} · due {new Date(`${expense.dueDate}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</small></div>
            </div>
            {!compact && expense.scope.startsWith("shared") && <div className="allocation"><small>My share</small><b>{money(myShare)}</b></div>}
            <div className="expense-amount"><strong>{money(expense.amount)}</strong><small>{expense.paid ? "Paid" : scopeName(expense.scope, data.planNames)}</small></div>
            <button className="row-menu" onClick={() => onEdit(expense)} aria-label={`Edit ${expense.title}`}>•••</button>
          </article>
        );
      })}
    </div>
  );
}

function AuditLog({ entries, planNames, query, setQuery, scope, setScope, action, setAction, date, setDate }: {
  entries: AuditEntry[]; planNames: Record<Person, string>; query: string; setQuery: (v: string) => void; scope: string; setScope: (v: string) => void;
  action: string; setAction: (v: string) => void; date: string; setDate: (v: string) => void;
}) {
  const actions = Array.from(new Set(entries.map((e) => e.actionType)));
  return (
    <>
      <div className="page-heading"><div><p className="eyebrow">Complete history</p><h1>Audit log</h1><p>Every meaningful change, kept on the server and easy to trace.</p></div><span className="secure-badge">◎ Server recorded</span></div>
      <section className="filter-bar">
        <label className="search"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search title, category or note…" /></label>
        <select value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Filter by scope"><option value="all">All budgets</option><option value="me">{planNames.me}</option><option value="partner">{planNames.partner}</option><option value="shared_housing">Housing</option><option value="shared_other">Household</option><option value="shared">Shared</option></select>
        <select value={action} onChange={(e) => setAction(e.target.value)} aria-label="Filter by action"><option value="all">All actions</option>{actions.map((a) => <option key={a} value={a}>{actionName(a)}</option>)}</select>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Filter by date" />
      </section>
      <section className="panel audit-panel">
        {entries.length ? entries.map((entry) => (
          <article className="audit-row" key={entry.id}>
            <span className={`audit-icon ${entry.actionType.includes("delete") ? "delete" : entry.actionType.includes("create") ? "create" : ""}`}>{entry.actionType.includes("delete") ? "−" : entry.actionType.includes("create") ? "+" : "↻"}</span>
            <div><strong>{entry.summary}</strong><p><span>{actionName(entry.actionType)}</span><span>{scopeName(entry.budgetScope, planNames)}</span><span>{entry.entityType}</span></p></div>
            <time dateTime={entry.timestamp}>{new Date(`${entry.timestamp.replace(" ", "T")}Z`).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</time>
          </article>
        )) : <div className="empty-state"><span>⌕</span><h3>No matching changes</h3><p>Try clearing one of the filters.</p></div>}
      </section>
    </>
  );
}

function Settings({ data, dark, setDark, openIncome, openSavings, openPlanName, openNote, removeNote }: {
  data: BudgetData; dark: boolean; setDark: (v: boolean) => void; openIncome: (p: Person) => void; openSavings: (p: Person) => void; openPlanName: (p: Person) => void; openNote: () => void; removeNote: (id: number) => void;
}) {
  return (
    <>
      <div className="page-heading"><div><p className="eyebrow">Household preferences</p><h1>Settings</h1><p>Keep the numbers and little details behind your plan up to date.</p></div></div>
      <div className="settings-grid">
        <section className="panel">
          <div className="panel-heading"><div><p className="eyebrow">Monthly</p><h2>Plans, income & savings</h2></div></div>
          {(["me", "partner"] as Person[]).map((person) => (
            <div className="settings-person" key={person}><span className={`avatar ${person}`}>{data.planNames[person].slice(0, 1).toUpperCase()}</span><div><strong>{data.planNames[person]}</strong><small>Income {money(data.incomes[person])} · Savings {money(data.savings[person])}</small></div><div className="settings-actions"><button className="text-button" onClick={() => openPlanName(person)}>Rename</button><button className="text-button" onClick={() => openIncome(person)}>Income</button><button className="text-button" onClick={() => openSavings(person)}>Savings</button></div></div>
          ))}
        </section>
        <section className="panel">
          <div className="panel-heading"><div><p className="eyebrow">Appearance</p><h2>Make it yours</h2></div></div>
          <label className="settings-toggle"><div><strong>Evening mode</strong><small>A softer dark palette for low light.</small></div><input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} /></label>
          <div className="settings-note"><span>✓</span><p><strong>Data lives on the server</strong><small>No budget records are kept in browser storage. Your household stays consistent across devices.</small></p></div>
        </section>
      </div>
      <section className="panel notes-panel">
        <div className="panel-heading"><div><p className="eyebrow">Shared context</p><h2>Household notes</h2></div><button className="primary-button small" onClick={openNote}>＋ Add note</button></div>
        {data.notes.map((note) => <article key={note.id}><p>{note.body}</p><small>Updated {new Date(`${note.updatedAt.replace(" ", "T")}Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}</small><button className="row-menu" onClick={() => removeNote(note.id)} aria-label="Delete note">×</button></article>)}
      </section>
    </>
  );
}
