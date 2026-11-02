import {
  pgTable,
  pgEnum,
  text,
  uuid,
  integer,
  bigserial,
  boolean,
  timestamp,
  date,
  doublePrecision,
  jsonb,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Data model for Kist, the field-collections app.
 *
 * Money is stored as whole rupees in integers (no paise needed for overdue amounts).
 * Business dates (as_of_date, promised_date) are plain DATEs in India time (IST).
 * Event times are timestamptz.
 */

export const roleEnum = pgEnum("role", ["officer", "manager", "head"]);
export const loanStatusEnum = pgEnum("loan_status", ["overdue", "cured", "closed"]);
export const outcomeTypeEnum = pgEnum("outcome_type", ["paid", "promise", "not_reachable", "dispute"]);
export const channelEnum = pgEnum("contact_channel", ["visit", "call"]);
export const attemptKindEnum = pgEnum("attempt_kind", ["call", "visit", "message"]);
export const promiseStatusEnum = pgEnum("promise_status", ["open", "kept", "broken", "superseded"]);
export const messageStatusEnum = pgEnum("message_status", ["sent_simulated", "blocked"]);

export const branches = pgTable("branches", {
  id: text("id").primaryKey(), // e.g. IDR
  name: text("name").notNull(),
  city: text("city").notNull(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    role: roleEnum("role").notNull(),
    branchId: text("branch_id").references(() => branches.id),
    passwordHash: text("password_hash").notNull(),
    language: text("language").notNull().default("hi"),
    maxLoad: integer("max_load").notNull().default(25),
    active: boolean("active").notNull().default(true),
    failedLogins: integer("failed_logins").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

/** Pincodes an officer covers. Used by auto-assignment. */
export const officerTerritories = pgTable(
  "officer_territories",
  {
    officerId: uuid("officer_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    pincode: text("pincode").notNull(),
  },
  (t) => [primaryKey({ columns: [t.officerId, t.pincode] }), index("territory_pincode_idx").on(t.pincode)],
);

export const borrowers = pgTable("borrowers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(), // business name
  contactName: text("contact_name").notNull(),
  phone: text("phone").notNull(), // 10-digit Indian mobile, synthetic in seed
  address: text("address").notNull(),
  pincode: text("pincode").notNull(),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  businessType: text("business_type").notNull().default(""),
  language: text("language").notNull().default("hi"),
});

export const loans = pgTable(
  "loans",
  {
    id: text("id").primaryKey(), // LN-10293
    borrowerId: uuid("borrower_id")
      .notNull()
      .references(() => borrowers.id),
    branchId: text("branch_id")
      .notNull()
      .references(() => branches.id),
    emi: integer("emi").notNull(),
    outstanding: integer("outstanding").notNull(),
    dpd: integer("dpd").notNull(),
    lastPaymentDate: date("last_payment_date"),
    paidRatio6m: doublePrecision("paid_ratio_6m"), // share of last 6 EMIs paid on time; null = not enough history
    disbursedOn: date("disbursed_on"),
    status: loanStatusEnum("status").notNull().default("overdue"),
    disputed: boolean("disputed").notNull().default(false),
    assignedOfficerId: uuid("assigned_officer_id").references(() => users.id),
    assignmentReason: text("assignment_reason"),
    assignedAt: timestamp("assigned_at", { withTimezone: true }),
    // Manager override of the AI order. Lower = higher in the list. Null = follow the score.
    manualRank: integer("manual_rank"),
    manualRankBy: uuid("manual_rank_by").references(() => users.id),
    lastImportDate: date("last_import_date"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("loans_officer_idx").on(t.assignedOfficerId),
    index("loans_branch_status_idx").on(t.branchId, t.status),
  ],
);

/** One row per loan per import day. Roll rates are computed from these. */
export const loanSnapshots = pgTable(
  "loan_snapshots",
  {
    loanId: text("loan_id")
      .notNull()
      .references(() => loans.id),
    asOfDate: date("as_of_date").notNull(),
    dpd: integer("dpd").notNull(),
    outstanding: integer("outstanding").notNull(),
    branchId: text("branch_id").notNull(),
    officerId: uuid("officer_id"),
  },
  (t) => [primaryKey({ columns: [t.loanId, t.asOfDate] }), index("snap_date_idx").on(t.asOfDate)],
);

export const imports = pgTable("imports", {
  id: uuid("id").primaryKey().defaultRandom(),
  asOfDate: date("as_of_date").notNull(),
  fileName: text("file_name").notNull(),
  uploadedBy: uuid("uploaded_by").references(() => users.id),
  rowCount: integer("row_count").notNull(),
  accepted: integer("accepted").notNull(),
  rejected: integer("rejected").notNull(),
  newLoans: integer("new_loans").notNull(),
  curedLoans: integer("cured_loans").notNull(),
  unassigned: integer("unassigned").notNull().default(0),
  errors: jsonb("errors").$type<{ line: number; loanId?: string; messages: string[] }[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Daily AI score per loan. Kept for the weekly back-test. */
export const scoreSnapshots = pgTable(
  "score_snapshots",
  {
    loanId: text("loan_id")
      .notNull()
      .references(() => loans.id),
    asOfDate: date("as_of_date").notNull(),
    score: integer("score").notNull(),
    pRoll: doublePrecision("p_roll").notNull(),
    reasons: jsonb("reasons").$type<ScoreReasonJson[]>().notNull(),
    limitedHistory: boolean("limited_history").notNull().default(false),
    modelVersion: text("model_version").notNull(),
  },
  (t) => [primaryKey({ columns: [t.loanId, t.asOfDate] }), index("score_date_idx").on(t.asOfDate)],
);

export type ScoreReasonJson = {
  key: string;
  effect: number;
  params: Record<string, string | number>;
};

/**
 * What happened when an officer visited or called. The id is generated on the phone,
 * so a retried offline sync can never create a duplicate.
 */
export const outcomes = pgTable(
  "outcomes",
  {
    id: uuid("id").primaryKey(),
    loanId: text("loan_id")
      .notNull()
      .references(() => loans.id),
    officerId: uuid("officer_id")
      .notNull()
      .references(() => users.id),
    type: outcomeTypeEnum("type").notNull(),
    channel: channelEnum("channel").notNull(),
    reason: text("reason"), // e.g. no_answer, switched_off, amount_disputed
    amount: integer("amount"),
    promisedDate: date("promised_date"),
    note: text("note"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    deviceTime: timestamp("device_time", { withTimezone: true }).notNull(),
    clockSkewMs: integer("clock_skew_ms").notNull().default(0),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    accuracyM: doublePrecision("accuracy_m"),
    gpsStatus: text("gps_status").notNull(), // ok | denied | unavailable | timeout
    createdOffline: boolean("created_offline").notNull().default(false),
    flags: text("flags").array().notNull().default([]),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("outcomes_loan_idx").on(t.loanId, t.occurredAt),
    index("outcomes_officer_idx").on(t.officerId, t.occurredAt),
  ],
);

/**
 * Every tap on Call, every visit and every reminder is recorded here, including the ones
 * the app blocked because they were outside 8 am to 7 pm.
 */
export const contactAttempts = pgTable(
  "contact_attempts",
  {
    id: uuid("id").primaryKey(),
    loanId: text("loan_id")
      .notNull()
      .references(() => loans.id),
    officerId: uuid("officer_id")
      .notNull()
      .references(() => users.id),
    kind: attemptKindEnum("kind").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    allowed: boolean("allowed").notNull(),
    blockedReason: text("blocked_reason"),
    flags: text("flags").array().notNull().default([]),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("attempts_loan_idx").on(t.loanId), index("attempts_officer_idx").on(t.officerId, t.occurredAt)],
);

export const promises = pgTable(
  "promises",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    loanId: text("loan_id")
      .notNull()
      .references(() => loans.id),
    outcomeId: uuid("outcome_id").references(() => outcomes.id),
    officerId: uuid("officer_id")
      .notNull()
      .references(() => users.id),
    promisedDate: date("promised_date").notNull(),
    amount: integer("amount").notNull(),
    status: promiseStatusEnum("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [index("promises_loan_idx").on(t.loanId), index("promises_status_date_idx").on(t.status, t.promisedDate)],
);

/** Approved reminder templates. Drafts can only be built from these. */
export const messageTemplates = pgTable("message_templates", {
  id: text("id").primaryKey(), // e.g. promise_due_today.hi
  purpose: text("purpose").notNull(), // promise_tomorrow | promise_today | promise_broken | overdue_first
  language: text("language").notNull(),
  body: text("body").notNull(),
  approvedBy: text("approved_by").notNull(),
  approvedOn: date("approved_on").notNull(),
  active: boolean("active").notNull().default(true),
});

/** Mock outbox: messages are never really sent in this build. */
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey(),
    loanId: text("loan_id")
      .notNull()
      .references(() => loans.id),
    officerId: uuid("officer_id")
      .notNull()
      .references(() => users.id),
    templateId: text("template_id")
      .notNull()
      .references(() => messageTemplates.id),
    language: text("language").notNull(),
    body: text("body").notNull(),
    status: messageStatusEnum("status").notNull(),
    blockedReason: text("blocked_reason"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("messages_loan_idx").on(t.loanId)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorId: uuid("actor_id"),
    actorRole: text("actor_role"),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    ip: text("ip"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_at_idx").on(t.at), index("audit_entity_idx").on(t.entityType, t.entityId)],
);
