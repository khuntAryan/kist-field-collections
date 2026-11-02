import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema, type DB } from "../db";
import { parseOverdueCsv, type ImportRow, type RowError } from "@/lib/csv-import";
import { assignLoans, type AssignmentReason } from "@/lib/assignment";
import { scoreLoans, saveScores } from "./scoring";
import { settlePromises } from "./promises";
import { audit } from "../audit";
import type { ISODate } from "@/lib/time";

export type ImportSummary = {
  asOfDate: ISODate;
  fileName: string;
  totalRows: number;
  accepted: number;
  errors: RowError[];
  missingColumns: string[];
  newLoans: number;
  updatedLoans: number;
  curedLoans: number;
  promisesKept: number;
  promisesBroken: number;
  officers: { id: string; name: string; branchId: string; total: number; added: number; maxLoad: number }[];
  unassigned: { loanId: string; reason: AssignmentReason }[];
  reassigned: number;
  /** Set when the file looks incomplete and would close too many loans. */
  needsConfirmation: null | { inFile: number; currentlyOverdue: number };
  importId?: string;
};

type Options = {
  csvText: string;
  fileName: string;
  asOfDate: ISODate;
  branchScope: string | null; // null = all branches (head of collections)
  actor: { id: string; role: string } | null;
  now: Date;
  confirmLargeCure?: boolean;
};

class DryRun extends Error {
  constructor(public summary: ImportSummary) {
    super("dry run");
  }
}

/** Runs the whole import and rolls it back, so the preview is exactly what commit will do. */
export async function previewImport(opts: Options): Promise<ImportSummary> {
  try {
    await db.transaction(async (tx) => {
      const summary = await runImport(tx, opts);
      throw new DryRun(summary);
    });
  } catch (e) {
    if (e instanceof DryRun) return e.summary;
    throw e;
  }
  throw new Error("unreachable");
}

export async function commitImport(opts: Options): Promise<ImportSummary> {
  try {
    return await db.transaction(async (tx) => {
      const summary = await runImport(tx, opts);
      // Nothing to save, or the file looks incomplete and the manager has not confirmed: undo.
      if (summary.missingColumns.length > 0 || summary.accepted === 0) throw new DryRun(summary);
      if (summary.needsConfirmation && !opts.confirmLargeCure) throw new DryRun(summary);
      return await saveImportRecord(tx, opts, summary);
    });
  } catch (e) {
    if (e instanceof DryRun) return e.summary;
    throw e;
  }
}

async function saveImportRecord(tx: DB, opts: Options, summary: ImportSummary): Promise<ImportSummary> {
  {
    const [row] = await tx
      .insert(schema.imports)
      .values({
        asOfDate: opts.asOfDate,
        fileName: opts.fileName,
        uploadedBy: opts.actor?.id ?? null,
        rowCount: summary.totalRows,
        accepted: summary.accepted,
        rejected: summary.errors.length,
        newLoans: summary.newLoans,
        curedLoans: summary.curedLoans,
        unassigned: summary.unassigned.length,
        errors: summary.errors.slice(0, 500),
      })
      .returning({ id: schema.imports.id });
    await audit(
      opts.actor,
      "import.commit",
      { type: "import", id: row.id },
      { asOfDate: opts.asOfDate, accepted: summary.accepted, rejected: summary.errors.length, cured: summary.curedLoans },
      { tx },
    );
    return { ...summary, importId: row.id };
  }
}

async function runImport(tx: DB, opts: Options): Promise<ImportSummary> {
  const branchRows = await tx.select({ id: schema.branches.id }).from(schema.branches);
  const known = opts.branchScope ? [opts.branchScope] : branchRows.map((b) => b.id);
  const parsed = parseOverdueCsv(opts.csvText, branchRows.map((b) => b.id), opts.asOfDate);

  // Managers can only import their own branch's rows.
  const errors = [...parsed.errors];
  const rows: ImportRow[] = [];
  for (const r of parsed.rows) {
    if (!known.includes(r.branchId)) {
      errors.push({ line: r.line, loanId: r.loanId, messages: [`Branch ${r.branchId} is not yours to import`] });
    } else rows.push(r);
  }
  errors.sort((a, b) => a.line - b.line);

  const empty: ImportSummary = {
    asOfDate: opts.asOfDate,
    fileName: opts.fileName,
    totalRows: parsed.totalRows,
    accepted: rows.length,
    errors,
    missingColumns: parsed.missingColumns,
    newLoans: 0,
    updatedLoans: 0,
    curedLoans: 0,
    promisesKept: 0,
    promisesBroken: 0,
    officers: [],
    unassigned: [],
    reassigned: 0,
    needsConfirmation: null,
  };
  if (parsed.missingColumns.length > 0 || rows.length === 0) return empty;

  const ids = rows.map((r) => r.loanId);
  const existing = await tx
    .select({
      id: schema.loans.id,
      borrowerId: schema.loans.borrowerId,
      status: schema.loans.status,
      assignedOfficerId: schema.loans.assignedOfficerId,
      manualRank: schema.loans.manualRank,
      paidRatio6m: schema.loans.paidRatio6m,
    })
    .from(schema.loans)
    .where(inArray(schema.loans.id, ids));
  const byId = new Map(existing.map((e) => [e.id, e]));

  // Overdue loans in scope that are missing from today's file have paid up.
  const scopeFilter = opts.branchScope ? eq(schema.loans.branchId, opts.branchScope) : sql`true`;
  const stillOverdue = await tx
    .select({ id: schema.loans.id })
    .from(schema.loans)
    .where(and(eq(schema.loans.status, "overdue"), scopeFilter));
  const inFile = new Set(ids);
  const cured = stillOverdue.map((l) => l.id).filter((id) => !inFile.has(id));

  const needsConfirmation =
    stillOverdue.length >= 20 && rows.length < stillOverdue.length * 0.5
      ? { inFile: rows.length, currentlyOverdue: stillOverdue.length }
      : null;

  // Borrowers and loans, upserted in bulk.
  const borrowerIds = new Map<string, string>();
  for (const r of rows) borrowerIds.set(r.loanId, byId.get(r.loanId)?.borrowerId ?? randomUUID());

  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    await tx
      .insert(schema.borrowers)
      .values(
        chunk.map((r) => ({
          id: borrowerIds.get(r.loanId)!,
          name: r.borrowerName,
          contactName: r.contactName,
          phone: r.phone,
          address: r.address,
          pincode: r.pincode,
          businessType: r.businessType,
          language: r.language,
        })),
      )
      .onConflictDoUpdate({
        target: schema.borrowers.id,
        set: {
          name: sql`excluded.name`,
          contactName: sql`excluded.contact_name`,
          phone: sql`excluded.phone`,
          address: sql`excluded.address`,
          pincode: sql`excluded.pincode`,
          businessType: sql`excluded.business_type`,
          language: sql`excluded.language`,
        },
      });
    await tx
      .insert(schema.loans)
      .values(
        chunk.map((r) => ({
          id: r.loanId,
          borrowerId: borrowerIds.get(r.loanId)!,
          branchId: r.branchId,
          emi: r.emi,
          outstanding: r.outstanding,
          dpd: r.dpd,
          lastPaymentDate: r.lastPaymentDate,
          paidRatio6m: r.paidOnTimeLast6 !== null ? r.paidOnTimeLast6 / 6 : (byId.get(r.loanId)?.paidRatio6m ?? null),
          status: "overdue" as const,
          lastImportDate: opts.asOfDate,
          updatedAt: opts.now,
        })),
      )
      .onConflictDoUpdate({
        target: schema.loans.id,
        set: {
          branchId: sql`excluded.branch_id`,
          emi: sql`excluded.emi`,
          outstanding: sql`excluded.outstanding`,
          dpd: sql`excluded.dpd`,
          lastPaymentDate: sql`excluded.last_payment_date`,
          paidRatio6m: sql`excluded.paid_ratio_6m`,
          status: sql`'overdue'`,
          lastImportDate: sql`excluded.last_import_date`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }

  if (cured.length > 0) {
    await tx
      .update(schema.loans)
      .set({ status: "cured", assignedOfficerId: null, manualRank: null, manualRankBy: null, updatedAt: opts.now })
      .where(inArray(schema.loans.id, cured));
    // Re-importing the same day: drop today's snapshot for loans no longer overdue.
    await tx
      .delete(schema.loanSnapshots)
      .where(and(inArray(schema.loanSnapshots.loanId, cured), eq(schema.loanSnapshots.asOfDate, opts.asOfDate)));
  }

  const settled = await settlePromises(tx, opts.asOfDate, cured, opts.now);

  // Score every loan in the file, then assign highest priority first.
  const scores = await scoreLoans(
    tx,
    rows.map((r) => ({
      id: r.loanId,
      dpd: r.dpd,
      outstanding: r.outstanding,
      lastPaymentDate: r.lastPaymentDate,
      paidRatio6m: r.paidOnTimeLast6 !== null ? r.paidOnTimeLast6 / 6 : (byId.get(r.loanId)?.paidRatio6m ?? null),
    })),
    opts.asOfDate,
  );

  const officerRows = await tx
    .select({
      id: schema.users.id,
      name: schema.users.name,
      branchId: schema.users.branchId,
      active: schema.users.active,
      maxLoad: schema.users.maxLoad,
    })
    .from(schema.users)
    .where(and(eq(schema.users.role, "officer"), opts.branchScope ? eq(schema.users.branchId, opts.branchScope) : sql`true`));
  const territories = await tx.select().from(schema.officerTerritories);
  const officers = officerRows.map((o) => ({
    id: o.id,
    name: o.name,
    branchId: o.branchId ?? "",
    active: o.active,
    maxLoad: o.maxLoad,
    pincodes: territories.filter((t) => t.officerId === o.id).map((t) => t.pincode),
  }));

  const assignments = assignLoans(
    rows.map((r) => ({
      id: r.loanId,
      branchId: r.branchId,
      pincode: r.pincode,
      outstanding: r.outstanding,
      score: scores.get(r.loanId)?.score ?? 0,
      currentOfficerId: byId.get(r.loanId)?.status === "overdue" ? (byId.get(r.loanId)?.assignedOfficerId ?? null) : null,
    })),
    officers,
  );

  let reassigned = 0;
  const values = assignments.map((a) => {
    const prev = byId.get(a.loanId);
    const changed = (prev?.assignedOfficerId ?? null) !== a.officerId;
    if (prev?.assignedOfficerId && changed) reassigned++;
    return { ...a, changed, keepRank: !changed && prev?.manualRank != null };
  });
  for (let i = 0; i < values.length; i += 500) {
    const chunk = values.slice(i, i + 500);
    const tuples = sql.join(
      chunk.map((v) => sql`(${v.loanId}::text, ${v.officerId}::uuid, ${v.reason}::text, ${v.changed}::boolean, ${v.keepRank}::boolean)`),
      sql`, `,
    );
    await tx.execute(sql`
      update loans set
        assigned_officer_id = v.officer_id,
        assignment_reason = v.reason,
        assigned_at = case when v.changed then ${opts.now}::timestamptz else coalesce(loans.assigned_at, ${opts.now}::timestamptz) end,
        manual_rank = case when v.keep_rank then loans.manual_rank else null end,
        manual_rank_by = case when v.keep_rank then loans.manual_rank_by else null end
      from (values ${tuples}) as v(loan_id, officer_id, reason, changed, keep_rank)
      where loans.id = v.loan_id`);
  }

  const officerOf = new Map(assignments.map((a) => [a.loanId, a.officerId]));
  for (let i = 0; i < rows.length; i += 500) {
    await tx
      .insert(schema.loanSnapshots)
      .values(
        rows.slice(i, i + 500).map((r) => ({
          loanId: r.loanId,
          asOfDate: opts.asOfDate,
          dpd: r.dpd,
          outstanding: r.outstanding,
          branchId: r.branchId,
          officerId: officerOf.get(r.loanId) ?? null,
        })),
      )
      .onConflictDoUpdate({
        target: [schema.loanSnapshots.loanId, schema.loanSnapshots.asOfDate],
        set: {
          dpd: sql`excluded.dpd`,
          outstanding: sql`excluded.outstanding`,
          branchId: sql`excluded.branch_id`,
          officerId: sql`excluded.officer_id`,
        },
      });
  }
  await saveScores(tx, scores, opts.asOfDate);

  const newIds = new Set(rows.filter((r) => !byId.has(r.loanId)).map((r) => r.loanId));
  const officerSummary = officers
    .filter((o) => o.active)
    .map((o) => {
      const mine = assignments.filter((a) => a.officerId === o.id);
      return {
        id: o.id,
        name: o.name,
        branchId: o.branchId,
        total: mine.length,
        added: mine.filter((a) => newIds.has(a.loanId) || a.reason !== "kept_with_officer").length,
        maxLoad: o.maxLoad,
      };
    })
    .sort((a, b) => a.branchId.localeCompare(b.branchId) || b.total - a.total);

  return {
    ...empty,
    newLoans: newIds.size,
    updatedLoans: rows.length - newIds.size,
    curedLoans: cured.length,
    promisesKept: settled.kept,
    promisesBroken: settled.broken,
    officers: officerSummary,
    unassigned: assignments.filter((a) => a.officerId === null).map((a) => ({ loanId: a.loanId, reason: a.reason })),
    reassigned,
    needsConfirmation,
  };
}
