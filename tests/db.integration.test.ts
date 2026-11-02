import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { istDateTime } from "@/lib/time";

const hasDb = !!process.env.TEST_DATABASE_URL;

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any, schema: any, sql: any, eq: any, applySync: any, previewImport: any, commitImport: any;

const DAY = "2026-11-02";
const noon = istDateTime(DAY, 12, 0);
const officerA = randomUUID();
const officerB = randomUUID();
const header = "loan_id,borrower_name,contact_name,phone,address,pincode,branch,outstanding,emi,dpd,last_payment_date,paid_on_time_last_6";
const row = (id: string, pin = "452001", dpd = 10) => `${id},Company ${id},A. Test,9826000000,Plot 1 Indore,${pin},IDR,300000,10000,${dpd},2026-09-20,5`;

function outcome(over: Record<string, unknown> = {}) {
  const at = (over.at as Date) ?? noon;
  return {
    id: randomUUID(),
    kind: "outcome",
    loanId: "LN-1001",
    deviceTime: at.toISOString(),
    occurredAt: at.toISOString(),
    serverOffsetMs: 0,
    createdOffline: false,
    type: "not_reachable",
    channel: "visit",
    reason: "no_answer",
    gps: { status: "ok", lat: 22.72, lng: 75.86, accuracy: 20 },
    ...over,
  };
}

describe.skipIf(!hasDb)("database: sync and import", () => {
  beforeAll(async () => {
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
    await pool.end();
    ({ db, schema } = await import("@/server/db"));
    ({ sql, eq } = await import("drizzle-orm"));
    ({ applySync } = await import("@/server/services/sync"));
    ({ previewImport, commitImport } = await import("@/server/services/import"));
  });

  beforeEach(async () => {
    await db.execute(sql`truncate table audit_log, messages, message_templates, promises, contact_attempts, outcomes,
      score_snapshots, imports, loan_snapshots, loans, borrowers, officer_territories, users, branches restart identity cascade`);
    await db.insert(schema.branches).values([{ id: "IDR", name: "Indore City", city: "Indore" }]);
    await db.insert(schema.users).values([
      { id: officerA, email: "a@kist.test", name: "Officer A", role: "officer", branchId: "IDR", passwordHash: "x", maxLoad: 30 },
      { id: officerB, email: "b@kist.test", name: "Officer B", role: "officer", branchId: "IDR", passwordHash: "x", maxLoad: 30 },
    ]);
    await db.insert(schema.officerTerritories).values([
      { officerId: officerA, pincode: "452001" },
      { officerId: officerB, pincode: "452010" },
    ]);
    await db.insert(schema.messageTemplates).values({ id: "overdue_reminder.en", purpose: "overdue_reminder", language: "en", body: "Hello {contact}", approvedBy: "test", approvedOn: DAY });
    const csv = [header, row("LN-1001", "452001"), row("LN-1002", "452010")].join("\n");
    await commitImport({ csvText: csv, fileName: "t.csv", asOfDate: DAY, branchScope: null, actor: null, now: istDateTime(DAY, 7, 30) });
  });

  const sync = (officer: string, events: unknown[], serverNow = noon, clientNow = serverNow) =>
    applySync({ id: officer, role: "officer" }, { clientNow: clientNow.toISOString(), events }, serverNow, null);

  it("assigns imported loans by pincode", async () => {
    const loans = await db.select().from(schema.loans);
    expect(loans.find((l: any) => l.id === "LN-1001").assignedOfficerId).toBe(officerA);
    expect(loans.find((l: any) => l.id === "LN-1002").assignedOfficerId).toBe(officerB);
  });

  it("accepts an entry once and treats a resend as a duplicate", async () => {
    const e = outcome();
    expect((await sync(officerA, [e]))[0].status).toBe("accepted");
    expect((await sync(officerA, [e]))[0].status).toBe("duplicate");
    const rows = await db.select().from(schema.outcomes);
    expect(rows.length).toBe(1);
  });

  it("refuses entries for a loan that is not the officer's", async () => {
    const [r] = await sync(officerB, [outcome()]);
    expect(r).toMatchObject({ status: "rejected", reason: "not_your_loan" });
  });

  it("blocks a contact logged after 7 pm and records the attempt", async () => {
    const late = istDateTime(DAY, 19, 30);
    const e = outcome({ at: late });
    const [r] = await sync(officerA, [e], istDateTime(DAY, 19, 31));
    expect(r).toMatchObject({ status: "rejected", reason: "outside_contact_window" });
    const [attempt] = await db.select().from(schema.contactAttempts).where(eq(schema.contactAttempts.id, e.id));
    expect(attempt.allowed).toBe(false);
    expect(attempt.flags).toContain("server_blocked");
  });

  it("re-checks the window on corrected time when the phone clock is slow", async () => {
    // Phone shows 6:45 pm, but it is 30 minutes slow: the contact really happened at 7:15 pm.
    const phone = istDateTime(DAY, 18, 45);
    const e = outcome({ at: phone, serverOffsetMs: 30 * 60_000 });
    const [r] = await sync(officerA, [e], istDateTime(DAY, 19, 20), istDateTime(DAY, 18, 50));
    expect(r.reason).toBe("outside_contact_window");
  });

  it("corrects a call attempt the phone allowed outside the window", async () => {
    const at = istDateTime(DAY, 21, 0);
    const e = { id: randomUUID(), kind: "attempt", loanId: "LN-1001", deviceTime: at.toISOString(), serverOffsetMs: 0, createdOffline: true, attemptKind: "call", allowed: true };
    await sync(officerA, [e], istDateTime(DAY, 21, 5));
    const [attempt] = await db.select().from(schema.contactAttempts).where(eq(schema.contactAttempts.id, e.id));
    expect(attempt).toMatchObject({ allowed: false, blockedReason: "after_window" });
    expect(attempt.flags).toContain("server_corrected");
  });

  it("never sends a reminder with threatening words, even if the phone let it through", async () => {
    const e = { id: randomUUID(), kind: "message", loanId: "LN-1001", deviceTime: noon.toISOString(), serverOffsetMs: 0, createdOffline: false, templateId: "overdue_reminder.en", language: "en", body: "Pay now or we call the police" };
    const [r] = await sync(officerA, [e]);
    expect(r).toMatchObject({ status: "rejected", reason: "blocked_words" });
    const [m] = await db.select().from(schema.messages);
    expect(m.status).toBe("blocked");
  });

  it("a new promise replaces the open one, and a payment of 90% keeps it", async () => {
    await sync(officerA, [outcome({ type: "promise", reason: undefined, promisedDate: "2026-11-05", amount: 10000 })]);
    await sync(officerA, [outcome({ type: "promise", reason: undefined, promisedDate: "2026-11-06", amount: 10000, at: istDateTime(DAY, 13, 0) })], istDateTime(DAY, 13, 1));
    let promises = await db.select().from(schema.promises);
    expect(promises.map((p: any) => p.status).sort()).toEqual(["open", "superseded"]);
    await sync(officerA, [outcome({ type: "paid", reason: "emi", amount: 9000, at: istDateTime(DAY, 15, 0) })], istDateTime(DAY, 15, 1));
    promises = await db.select().from(schema.promises);
    expect(promises.find((p: any) => p.promisedDate === "2026-11-06").status).toBe("kept");
  });

  it("previews an import without changing anything", async () => {
    const before = await db.select().from(schema.loans);
    const csv = [header, row("LN-1001"), row("LN-1003", "452001", 2)].join("\n");
    const s = await previewImport({ csvText: csv, fileName: "t.csv", asOfDate: DAY, branchScope: null, actor: null, now: noon });
    expect(s).toMatchObject({ newLoans: 1, curedLoans: 1, accepted: 2 });
    const after = await db.select().from(schema.loans);
    expect(after.length).toBe(before.length);
    expect(after.every((l: any) => l.status === "overdue")).toBe(true);
  });

  it("closes loans missing from the new file and counts their open promise as kept", async () => {
    await sync(officerB, [outcome({ loanId: "LN-1002", type: "promise", reason: undefined, promisedDate: "2026-11-04", amount: 10000 })]);
    const csv = [header, row("LN-1001")].join("\n");
    const s = await commitImport({ csvText: csv, fileName: "t.csv", asOfDate: "2026-11-03", branchScope: null, actor: null, now: istDateTime("2026-11-03", 7, 30) });
    expect(s.curedLoans).toBe(1);
    const [loan] = await db.select().from(schema.loans).where(eq(schema.loans.id, "LN-1002"));
    expect(loan).toMatchObject({ status: "cured", assignedOfficerId: null });
    const [p] = await db.select().from(schema.promises);
    expect(p.status).toBe("kept");
  });

  it("asks for confirmation before a short file closes most of the book", async () => {
    const many = Array.from({ length: 24 }, (_, i) => row(`LN-2${String(i).padStart(3, "0")}`));
    await commitImport({ csvText: [header, ...many].join("\n"), fileName: "t.csv", asOfDate: DAY, branchScope: null, actor: null, now: noon });
    const short = [header, ...many.slice(0, 5)].join("\n");
    const s = await commitImport({ csvText: short, fileName: "t.csv", asOfDate: DAY, branchScope: null, actor: null, now: noon });
    expect(s.needsConfirmation).not.toBeNull();
    expect(s.importId).toBeUndefined();
    const stillOverdue = await db.select().from(schema.loans).where(eq(schema.loans.status, "overdue"));
    expect(stillOverdue.length).toBe(24);
  });
});
