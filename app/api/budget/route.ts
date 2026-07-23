import { env } from "cloudflare:workers";
import { calculateSharedSplits, scopeLabel } from "../../../lib/budget-rules";

type D1Row = Record<string, string | number | null>;

const tables = [
  `CREATE TABLE IF NOT EXISTS incomes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person TEXT NOT NULL UNIQUE CHECK(person IN ('me','partner')),
    amount REAL NOT NULL DEFAULT 0 CHECK(amount >= 0),
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    amount REAL NOT NULL CHECK(amount >= 0),
    scope TEXT NOT NULL CHECK(scope IN ('me','partner','shared_housing','shared_other')),
    category TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    due_date TEXT NOT NULL,
    recurring INTEGER NOT NULL DEFAULT 0,
    paid INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS savings_allocations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person TEXT NOT NULL UNIQUE CHECK(person IN ('me','partner')),
    amount REAL NOT NULL DEFAULT 0 CHECK(amount >= 0),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS plan_names (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person TEXT NOT NULL UNIQUE CHECK(person IN ('me','partner')),
    name TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL DEFAULT 'shared',
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    user_id TEXT NOT NULL DEFAULT 'household',
    action_type TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    budget_scope TEXT NOT NULL,
    before_value TEXT,
    after_value TEXT,
    summary TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS audit_timestamp_idx ON audit_logs(timestamp DESC)`,
  `CREATE INDEX IF NOT EXISTS expense_scope_idx ON expenses(scope)`,
];

const seedExpenses = [
  ["Mortgage", 1450, "shared_housing", "Housing", "Monthly mortgage payment", "2026-08-01", 1, 0],
  ["Service charge", 125, "shared_housing", "Housing", "Building maintenance", "2026-08-03", 1, 0],
  ["Groceries", 520, "shared_other", "Groceries", "Monthly food budget", "2026-08-31", 1, 0],
  ["Energy", 168, "shared_other", "Utilities", "Electricity and gas", "2026-08-14", 1, 1],
  ["Broadband", 42, "shared_other", "Internet", "Fibre plan", "2026-08-18", 1, 0],
  ["Council tax", 188, "shared_other", "Council tax", "Monthly instalment", "2026-08-05", 1, 1],
  ["Gym", 48, "me", "Wellbeing", "Monthly membership", "2026-08-12", 1, 0],
  ["Phone", 32, "me", "Phone", "Mobile plan", "2026-08-21", 1, 1],
  ["Train pass", 156, "partner", "Transport", "Monthly commute", "2026-08-02", 1, 1],
  ["Book club", 24, "partner", "Leisure", "Monthly membership", "2026-08-20", 1, 0],
] as const;

function database() {
  if (!env.DB) throw new Error("Database binding is unavailable.");
  return env.DB;
}

async function initialize() {
  const db = database();
  await db.batch(tables.map((statement) => db.prepare(statement)));
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO plan_names(person, name) VALUES (?, ?)").bind("me", "My budget"),
    db.prepare("INSERT OR IGNORE INTO plan_names(person, name) VALUES (?, ?)").bind("partner", "Partner budget"),
  ]);
  const count = await db.prepare("SELECT COUNT(*) AS count FROM incomes").first<{ count: number }>();
  if ((count?.count ?? 0) > 0) return;

  await db.batch([
    db.prepare("INSERT INTO incomes(person, amount, note) VALUES (?, ?, ?)").bind("me", 4200, "Net monthly salary"),
    db.prepare("INSERT INTO incomes(person, amount, note) VALUES (?, ?, ?)").bind("partner", 2800, "Net monthly salary"),
    db.prepare("INSERT INTO savings_allocations(person, amount) VALUES (?, ?)").bind("me", 850),
    db.prepare("INSERT INTO savings_allocations(person, amount) VALUES (?, ?)").bind("partner", 500),
    ...seedExpenses.map((item) =>
      db.prepare(
        "INSERT INTO expenses(title, amount, scope, category, notes, due_date, recurring, paid) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(...item),
    ),
    db.prepare("INSERT INTO notes(scope, body) VALUES (?, ?)").bind(
      "shared",
      "Review energy tariff before the renewal date.",
    ),
    db.prepare(
      "INSERT INTO audit_logs(action_type, entity_type, entity_id, budget_scope, after_value, summary) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind("seed", "household", "household", "shared", "{}", "Starter household budget created"),
  ]);
}

const cleanExpense = (row: D1Row) => ({
  id: Number(row.id),
  title: String(row.title),
  amount: Number(row.amount),
  scope: String(row.scope),
  category: String(row.category),
  notes: String(row.notes ?? ""),
  dueDate: String(row.due_date),
  recurring: Boolean(row.recurring),
  paid: Boolean(row.paid),
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
});

async function currentPlanNames() {
  const result = await database().prepare("SELECT person, name FROM plan_names ORDER BY person").all<D1Row>();
  const names = { me: "My budget", partner: "Partner budget" };
  for (const row of result.results) names[row.person as "me" | "partner"] = String(row.name);
  return names;
}

async function snapshot() {
  const db = database();
  const [incomeResult, expenseResult, savingsResult, planNameResult, noteResult, auditResult] = await Promise.all([
    db.prepare("SELECT * FROM incomes ORDER BY person").all<D1Row>(),
    db.prepare("SELECT * FROM expenses ORDER BY due_date, id").all<D1Row>(),
    db.prepare("SELECT * FROM savings_allocations ORDER BY person").all<D1Row>(),
    db.prepare("SELECT * FROM plan_names ORDER BY person").all<D1Row>(),
    db.prepare("SELECT * FROM notes ORDER BY updated_at DESC").all<D1Row>(),
    db.prepare("SELECT * FROM audit_logs ORDER BY timestamp DESC, id DESC LIMIT 500").all<D1Row>(),
  ]);

  const incomes = { me: 0, partner: 0 };
  for (const row of incomeResult.results) incomes[row.person as "me" | "partner"] = Number(row.amount);
  const expenses = expenseResult.results.map(cleanExpense);
  const savings = { me: 0, partner: 0 };
  for (const row of savingsResult.results) savings[row.person as "me" | "partner"] = Number(row.amount);
  const planNames = { me: "My budget", partner: "Partner budget" };
  for (const row of planNameResult.results) planNames[row.person as "me" | "partner"] = String(row.name);
  const housingTotal = expenses.filter((e) => e.scope === "shared_housing").reduce((n, e) => n + e.amount, 0);
  const otherTotal = expenses.filter((e) => e.scope === "shared_other").reduce((n, e) => n + e.amount, 0);
  const split = calculateSharedSplits(incomes, housingTotal, otherTotal);
  const personal = {
    me: expenses.filter((e) => e.scope === "me").reduce((n, e) => n + e.amount, 0),
    partner: expenses.filter((e) => e.scope === "partner").reduce((n, e) => n + e.amount, 0),
  };
  const committed = {
    me: personal.me + split.housingShares.me + split.otherShares.me,
    partner: personal.partner + split.housingShares.partner + split.otherShares.partner,
  };

  return {
    incomes,
    expenses,
    savings,
    planNames,
    notes: noteResult.results.map((row) => ({
      id: Number(row.id),
      scope: String(row.scope),
      body: String(row.body),
      updatedAt: String(row.updated_at),
    })),
    audit: auditResult.results.map((row) => ({
      id: Number(row.id),
      timestamp: String(row.timestamp),
      userId: String(row.user_id),
      actionType: String(row.action_type),
      entityType: String(row.entity_type),
      entityId: String(row.entity_id),
      budgetScope: String(row.budget_scope),
      beforeValue: row.before_value ? JSON.parse(String(row.before_value)) : null,
      afterValue: row.after_value ? JSON.parse(String(row.after_value)) : null,
      summary: String(row.summary),
    })),
    totals: {
      housing: housingTotal,
      other: otherTotal,
      personal,
      committed,
      remainingBeforeSavings: {
        me: incomes.me - committed.me,
        partner: incomes.partner - committed.partner,
      },
      disposable: {
        me: incomes.me - committed.me - savings.me,
        partner: incomes.partner - committed.partner - savings.partner,
      },
    },
    split,
  };
}

async function audit(
  action: string,
  entityType: string,
  entityId: string,
  scope: string,
  before: unknown,
  after: unknown,
  summary: string,
) {
  await database()
    .prepare(
      "INSERT INTO audit_logs(action_type, entity_type, entity_id, budget_scope, before_value, after_value, summary) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(action, entityType, entityId, scope, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, summary)
    .run();
}

export async function GET() {
  try {
    await initialize();
    return Response.json(await snapshot());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load budget" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await initialize();
    const body = (await request.json()) as Record<string, unknown>;
    const kind = String(body.kind ?? "");
    const db = database();

    if (kind === "expense") {
      const title = String(body.title ?? "").trim();
      const amount = Number(body.amount);
      const scope = String(body.scope ?? "");
      if (!title || !Number.isFinite(amount) || amount < 0 || !["me", "partner", "shared_housing", "shared_other"].includes(scope)) {
        return Response.json({ error: "Please enter a title, valid amount and budget." }, { status: 400 });
      }
      const record = {
        title,
        amount,
        scope,
        category: String(body.category ?? "Other"),
        notes: String(body.notes ?? ""),
        dueDate: String(body.dueDate ?? ""),
        recurring: Boolean(body.recurring),
        paid: Boolean(body.paid),
      };
      const result = await db
        .prepare("INSERT INTO expenses(title, amount, scope, category, notes, due_date, recurring, paid) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(record.title, record.amount, record.scope, record.category, record.notes, record.dueDate, record.recurring ? 1 : 0, record.paid ? 1 : 0)
        .run();
      const id = String(result.meta.last_row_id);
      await audit("create_expense", "expense", id, scope, null, record, `Added ${record.title} to ${scopeLabel(scope, await currentPlanNames())}`);
    } else if (kind === "note") {
      const note = String(body.body ?? "").trim();
      if (!note) return Response.json({ error: "Note cannot be empty." }, { status: 400 });
      const result = await db.prepare("INSERT INTO notes(scope, body) VALUES (?, ?)").bind(String(body.scope ?? "shared"), note).run();
      await audit("create_note", "note", String(result.meta.last_row_id), String(body.scope ?? "shared"), null, { body: note }, "Added a household note");
    } else {
      return Response.json({ error: "Unsupported record type." }, { status: 400 });
    }
    return Response.json(await snapshot(), { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to save" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    await initialize();
    const body = (await request.json()) as Record<string, unknown>;
    const kind = String(body.kind ?? "");
    const db = database();

    if (kind === "plan_name") {
      const person = String(body.person);
      const name = String(body.name ?? "").trim();
      if (!["me", "partner"].includes(person) || !name || name.length > 40) {
        return Response.json({ error: "Plan names must be between 1 and 40 characters." }, { status: 400 });
      }
      const before = await db.prepare("SELECT * FROM plan_names WHERE person = ?").bind(person).first<D1Row>();
      if (!before) return Response.json({ error: "Plan not found." }, { status: 404 });
      await db.prepare("UPDATE plan_names SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE person = ?").bind(name, person).run();
      await audit("edit_plan_name", "plan", person, person, before, { name }, `Renamed ${String(before.name)} to ${name}`);
    } else if (kind === "income") {
      const person = String(body.person);
      const amount = Number(body.amount);
      if (!["me", "partner"].includes(person) || !Number.isFinite(amount) || amount < 0) {
        return Response.json({ error: "Income must be zero or more." }, { status: 400 });
      }
      const before = await db.prepare("SELECT * FROM incomes WHERE person = ?").bind(person).first();
      await db.prepare("UPDATE incomes SET amount = ?, note = ?, updated_at = CURRENT_TIMESTAMP WHERE person = ?")
        .bind(amount, String(body.note ?? ""), person).run();
      const names = await currentPlanNames();
      await audit("edit_income", "income", person, person, before, { amount, note: body.note }, `Updated ${names[person as "me" | "partner"]} income to £${amount.toFixed(2)}; shared split recalculated`);
    } else if (kind === "savings") {
      const person = String(body.person);
      const amount = Number(body.amount);
      if (!["me", "partner"].includes(person) || !Number.isFinite(amount) || amount < 0) {
        return Response.json({ error: "Savings must be zero or more." }, { status: 400 });
      }
      const before = await db.prepare("SELECT * FROM savings_allocations WHERE person = ?").bind(person).first();
      await db.prepare("UPDATE savings_allocations SET amount = ?, updated_at = CURRENT_TIMESTAMP WHERE person = ?").bind(amount, person).run();
      const names = await currentPlanNames();
      await audit("edit_savings", "savings", person, person, before, { amount }, `Updated ${names[person as "me" | "partner"]} planned savings to £${amount.toFixed(2)}`);
    } else if (kind === "expense") {
      const id = Number(body.id);
      const beforeRow = await db.prepare("SELECT * FROM expenses WHERE id = ?").bind(id).first<D1Row>();
      if (!beforeRow) return Response.json({ error: "Expense not found." }, { status: 404 });
      const before = cleanExpense(beforeRow);
      const next = {
        title: String(body.title ?? before.title).trim(),
        amount: Number(body.amount ?? before.amount),
        scope: String(body.scope ?? before.scope),
        category: String(body.category ?? before.category),
        notes: String(body.notes ?? before.notes),
        dueDate: String(body.dueDate ?? before.dueDate),
        recurring: body.recurring === undefined ? before.recurring : Boolean(body.recurring),
        paid: body.paid === undefined ? before.paid : Boolean(body.paid),
      };
      if (!next.title || !Number.isFinite(next.amount) || next.amount < 0 || !["me", "partner", "shared_housing", "shared_other"].includes(next.scope)) {
        return Response.json({ error: "Expense details are invalid." }, { status: 400 });
      }
      await db.prepare(
        "UPDATE expenses SET title = ?, amount = ?, scope = ?, category = ?, notes = ?, due_date = ?, recurring = ?, paid = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      ).bind(next.title, next.amount, next.scope, next.category, next.notes, next.dueDate, next.recurring ? 1 : 0, next.paid ? 1 : 0, id).run();
      const action = before.scope !== next.scope ? "change_expense_type" : before.paid !== next.paid ? "mark_paid_unpaid" : before.recurring !== next.recurring ? "toggle_recurring" : "edit_expense";
      await audit(action, "expense", String(id), next.scope, before, next, `${next.title} updated in ${scopeLabel(next.scope, await currentPlanNames())}`);
    } else if (kind === "note") {
      const id = Number(body.id);
      const before = await db.prepare("SELECT * FROM notes WHERE id = ?").bind(id).first();
      const note = String(body.body ?? "").trim();
      if (!before || !note) return Response.json({ error: "Note is invalid." }, { status: 400 });
      await db.prepare("UPDATE notes SET body = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(note, id).run();
      await audit("edit_note", "note", String(id), String(body.scope ?? "shared"), before, { body: note }, "Updated a household note");
    } else {
      return Response.json({ error: "Unsupported update." }, { status: 400 });
    }
    return Response.json(await snapshot());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to update" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    await initialize();
    const url = new URL(request.url);
    const kind = url.searchParams.get("kind");
    const id = Number(url.searchParams.get("id"));
    if (!id || !["expense", "note"].includes(kind ?? "")) return Response.json({ error: "Invalid record." }, { status: 400 });
    const db = database();
    const table = kind === "expense" ? "expenses" : "notes";
    const before = await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first<D1Row>();
    if (!before) return Response.json({ error: "Record not found." }, { status: 404 });
    await db.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
    const scope = String(before.scope ?? "shared");
    await audit(`delete_${kind}`, kind!, String(id), scope, before, null, kind === "expense" ? `Deleted ${String(before.title)} from ${scopeLabel(scope, await currentPlanNames())}` : "Deleted a household note");
    return Response.json(await snapshot());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to delete" }, { status: 500 });
  }
}
