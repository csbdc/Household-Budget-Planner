import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const incomes = sqliteTable("incomes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  person: text("person", { enum: ["me", "partner"] }).notNull().unique(),
  amount: real("amount").notNull().default(0),
  note: text("note").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const expenses = sqliteTable("expenses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  amount: real("amount").notNull(),
  scope: text("scope", {
    enum: ["me", "partner", "shared_housing", "shared_other"],
  }).notNull(),
  category: text("category").notNull(),
  notes: text("notes").notNull().default(""),
  dueDate: text("due_date").notNull(),
  recurring: integer("recurring", { mode: "boolean" }).notNull().default(false),
  paid: integer("paid", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const savingsAllocations = sqliteTable("savings_allocations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  person: text("person", { enum: ["me", "partner"] }).notNull().unique(),
  amount: real("amount").notNull().default(0),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const planNames = sqliteTable("plan_names", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  person: text("person", { enum: ["me", "partner"] }).notNull().unique(),
  name: text("name").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const notes = sqliteTable("notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  scope: text("scope").notNull().default("shared"),
  body: text("body").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const auditLogs = sqliteTable("audit_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  timestamp: text("timestamp").notNull().default(sql`CURRENT_TIMESTAMP`),
  userId: text("user_id").notNull().default("household"),
  actionType: text("action_type").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  budgetScope: text("budget_scope").notNull(),
  beforeValue: text("before_value"),
  afterValue: text("after_value"),
  summary: text("summary").notNull(),
});
