import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lte, max, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { computeRollRate, nearestOnOrBefore, type RollSnapshot } from "@/lib/roll-rate";
import { addDays, istDate, weekStart, type ISODate } from "@/lib/time";
import { compareForList } from "@/lib/scoring/score";
import { overdueAmountOf } from "./officer";

const istDay = (col: unknown) => sql<string>`((${col}) at time zone 'Asia/Kolkata')::date::text`;
const branchIs = (col: Parameters<typeof eq>[0], scope: string | null) => (scope ? eq(col, scope) : sql`true`);

export async function getBranches() {
  return db.select().from(schema.branches).orderBy(asc(schema.branches.name));
}

export async function latestFileDate(scope: string | null): Promise<ISODate | null> {
  const [r] = await db.select({ d: max(schema.loans.lastImportDate) }).from(schema.loans).where(branchIs(schema.loans.branchId, scope));
  return r?.d ?? null;
}

// ---------------------------------------------------------------------------------------------
// Roll rates
// ---------------------------------------------------------------------------------------------
export type RollPoint = { endDate: ISODate; byBranch: Record<string, { cohort: number; rolled: number; rate: number | null }>; overall: { cohort: number; rolled: number; rate: number | null } };

/** Weekly roll-rate points (30-day window) ending on the latest file date. */
export async function rollRateTrend(scope: string | null, endDate: ISODate, weeks = 8): Promise<RollPoint[]> {
  const ends = Array.from({ length: weeks }, (_, i) => addDays(endDate, -7 * (weeks - 1 - i)));
  const available = (
    await db
      .selectDistinct({ d: schema.loanSnapshots.asOfDate })
      .from(schema.loanSnapshots)
      .where(and(gte(schema.loanSnapshots.asOfDate, addDays(ends[0], -40)), lte(schema.loanSnapshots.asOfDate, endDate)))
  ).map((r) => r.d);

  const pairs = ends.map((e) => ({ end: nearestOnOrBefore(available, e), start: nearestOnOrBefore(available, addDays(e, -30)), label: e }));
  const needed = [...new Set(pairs.flatMap((p) => [p.end, p.start]).filter((d): d is string => !!d))];
  if (needed.length === 0) return [];
  const rows = await db
    .select({ loanId: schema.loanSnapshots.loanId, dpd: schema.loanSnapshots.dpd, branchId: schema.loanSnapshots.branchId, d: schema.loanSnapshots.asOfDate })
    .from(schema.loanSnapshots)
    .where(and(inArray(schema.loanSnapshots.asOfDate, needed), branchIs(schema.loanSnapshots.branchId, scope)));
  const byDate = new Map<string, RollSnapshot[]>();
  for (const r of rows) {
    const list = byDate.get(r.d) ?? [];
    list.push(r);
    byDate.set(r.d, list);
  }
  return pairs
    .filter((p) => p.start && p.end)
    .map((p) => {
      const rr = computeRollRate(byDate.get(p.start!) ?? [], byDate.get(p.end!) ?? []);
      return { endDate: p.label, byBranch: rr.byBranch, overall: rr.overall };
    });
}

// ---------------------------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------------------------
export async function getOverview(scope: string | null, now: Date) {
  const today = istDate(now);
  const fileDate = (await latestFileDate(scope)) ?? today;
  const [branches, trend] = await Promise.all([getBranches(), rollRateTrend(scope, fileDate)]);

  const book = await db
    .select({
      branchId: schema.loans.branchId,
      loans: sql<number>`count(*)::int`,
      outstanding: sql<number>`coalesce(sum(${schema.loans.outstanding}),0)::bigint`,
      overdue: sql<number>`coalesce(sum(${schema.loans.emi} * greatest(1, ceil(${schema.loans.dpd} / 30.0))),0)::bigint`,
      unassigned: sql<number>`count(*) filter (where ${schema.loans.assignedOfficerId} is null)::int`,
      disputed: sql<number>`count(*) filter (where ${schema.loans.disputed})::int`,
    })
    .from(schema.loans)
    .where(and(eq(schema.loans.status, "overdue"), branchIs(schema.loans.branchId, scope)))
    .groupBy(schema.loans.branchId);

  const promiseStats = await db
    .select({
      branchId: schema.loans.branchId,
      brokenWeek: sql<number>`count(*) filter (where ${schema.promises.status} = 'broken' and ${schema.promises.promisedDate} >= ${addDays(today, -7)}::date and ${schema.promises.promisedDate} < ${today}::date)::int`,
      dueToday: sql<number>`count(*) filter (where ${schema.promises.status} = 'open' and ${schema.promises.promisedDate} = ${today}::date)::int`,
      keptWeek: sql<number>`count(*) filter (where ${schema.promises.status} = 'kept' and ${schema.promises.promisedDate} >= ${addDays(today, -7)}::date)::int`,
    })
    .from(schema.promises)
    .innerJoin(schema.loans, eq(schema.loans.id, schema.promises.loanId))
    .where(branchIs(schema.loans.branchId, scope))
    .groupBy(schema.loans.branchId);

  const since7 = new Date(now.getTime() - 7 * 86_400_000);
  const activity = await db
    .select({
      branchId: schema.loans.branchId,
      today: sql<number>`count(*) filter (where ${istDay(schema.outcomes.occurredAt)} = ${today})::int`,
      week: sql<number>`count(*) filter (where ${schema.outcomes.occurredAt} >= ${since7})::int`,
      sameDay: sql<number>`count(*) filter (where ${schema.outcomes.occurredAt} >= ${since7} and ${istDay(schema.outcomes.occurredAt)} = ${istDay(schema.outcomes.syncedAt)})::int`,
    })
    .from(schema.outcomes)
    .innerJoin(schema.loans, eq(schema.loans.id, schema.outcomes.loanId))
    .where(and(gte(schema.outcomes.occurredAt, since7), branchIs(schema.loans.branchId, scope)))
    .groupBy(schema.loans.branchId);

  const officers = await getOfficerStats(scope, now);

  const sum = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + Number(f(r)), 0);
  const last = trend[trend.length - 1];
  const prev = trend[trend.length - 2];
  return {
    today,
    fileDate,
    branches: branches.filter((b) => !scope || b.id === scope),
    trend,
    kpi: {
      rollRate: last?.overall ?? null,
      rollRatePrev: prev?.overall ?? null,
      brokenWeek: sum(promiseStats, (r) => r.brokenWeek),
      keptWeek: sum(promiseStats, (r) => r.keptWeek),
      dueToday: sum(promiseStats, (r) => r.dueToday),
      visitsToday: sum(activity, (r) => r.today),
      sameDayRate: sum(activity, (r) => r.week) ? sum(activity, (r) => r.sameDay) / sum(activity, (r) => r.week) : null,
      overdueLoans: sum(book, (r) => r.loans),
      overdueAmount: sum(book, (r) => r.overdue),
      outstanding: sum(book, (r) => r.outstanding),
      unassigned: sum(book, (r) => r.unassigned),
    },
    byBranch: branches
      .filter((b) => !scope || b.id === scope)
      .map((b) => {
        const k = book.find((r) => r.branchId === b.id);
        const p = promiseStats.find((r) => r.branchId === b.id);
        const a = activity.find((r) => r.branchId === b.id);
        return {
          id: b.id,
          name: b.name,
          loans: k?.loans ?? 0,
          overdue: Number(k?.overdue ?? 0),
          outstanding: Number(k?.outstanding ?? 0),
          unassigned: k?.unassigned ?? 0,
          rollRate: last?.byBranch[b.id] ?? null,
          brokenWeek: p?.brokenWeek ?? 0,
          dueToday: p?.dueToday ?? 0,
          visitsToday: a?.today ?? 0,
          sameDayRate: a?.week ? a.sameDay / a.week : null,
        };
      }),
    officers,
  };
}

export async function getOfficerStats(scope: string | null, now: Date) {
  const today = istDate(now);
  const since7 = new Date(now.getTime() - 7 * 86_400_000);
  const officers = await db
    .select({ id: schema.users.id, name: schema.users.name, branchId: schema.users.branchId, maxLoad: schema.users.maxLoad, active: schema.users.active })
    .from(schema.users)
    .where(and(eq(schema.users.role, "officer"), branchIs(schema.users.branchId, scope)))
    .orderBy(asc(schema.users.branchId), asc(schema.users.name));
  const ids = officers.map((o) => o.id);
  if (ids.length === 0) return [];

  const loads = await db
    .select({ id: schema.loans.assignedOfficerId, n: sql<number>`count(*)::int`, overdue: sql<number>`coalesce(sum(${schema.loans.emi} * greatest(1, ceil(${schema.loans.dpd} / 30.0))),0)::bigint` })
    .from(schema.loans)
    .where(and(eq(schema.loans.status, "overdue"), inArray(schema.loans.assignedOfficerId, ids)))
    .groupBy(schema.loans.assignedOfficerId);
  const outs = await db
    .select({
      id: schema.outcomes.officerId,
      today: sql<number>`count(*) filter (where ${istDay(schema.outcomes.occurredAt)} = ${today})::int`,
      paidToday: sql<number>`count(*) filter (where ${istDay(schema.outcomes.occurredAt)} = ${today} and ${schema.outcomes.type} = 'paid')::int`,
      promiseToday: sql<number>`count(*) filter (where ${istDay(schema.outcomes.occurredAt)} = ${today} and ${schema.outcomes.type} = 'promise')::int`,
      week: sql<number>`count(*)::int`,
      sameDay: sql<number>`count(*) filter (where ${istDay(schema.outcomes.occurredAt)} = ${istDay(schema.outcomes.syncedAt)})::int`,
      noGps: sql<number>`count(*) filter (where ${schema.outcomes.gpsStatus} <> 'ok')::int`,
      lastSync: sql<string | null>`max(${schema.outcomes.syncedAt})::text`,
    })
    .from(schema.outcomes)
    .where(and(inArray(schema.outcomes.officerId, ids), gte(schema.outcomes.occurredAt, since7)))
    .groupBy(schema.outcomes.officerId);
  const broken = await db
    .select({ id: schema.promises.officerId, n: sql<number>`count(*)::int` })
    .from(schema.promises)
    .where(and(inArray(schema.promises.officerId, ids), eq(schema.promises.status, "broken"), gte(schema.promises.promisedDate, addDays(today, -7))))
    .groupBy(schema.promises.officerId);
  const blocked = await db
    .select({ id: schema.contactAttempts.officerId, n: sql<number>`count(*)::int` })
    .from(schema.contactAttempts)
    .where(and(inArray(schema.contactAttempts.officerId, ids), eq(schema.contactAttempts.allowed, false), gte(schema.contactAttempts.occurredAt, since7)))
    .groupBy(schema.contactAttempts.officerId);

  return officers.map((o) => {
    const l = loads.find((x) => x.id === o.id);
    const a = outs.find((x) => x.id === o.id);
    return {
      ...o,
      assigned: l?.n ?? 0,
      overdue: Number(l?.overdue ?? 0),
      contactedToday: a?.today ?? 0,
      paidToday: a?.paidToday ?? 0,
      promiseToday: a?.promiseToday ?? 0,
      sameDayRate: a?.week ? a.sameDay / a.week : null,
      noGpsWeek: a?.noGps ?? 0,
      lastSync: a?.lastSync ? new Date(a.lastSync) : null,
      brokenWeek: broken.find((x) => x.id === o.id)?.n ?? 0,
      blockedWeek: blocked.find((x) => x.id === o.id)?.n ?? 0,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Officer lists
// ---------------------------------------------------------------------------------------------
export type ListLoan = {
  id: string;
  branchId: string;
  name: string;
  businessType: string;
  pincode: string;
  dpd: number;
  overdue: number;
  outstanding: number;
  score: number;
  reasons: { key: string; effect: number; params: Record<string, string | number> }[];
  limitedHistory: boolean;
  manualRank: number | null;
  assignmentReason: string | null;
  disputed: boolean;
  promise: { date: string; status: string } | null;
  todayOutcome: string | null;
  officerId: string | null;
};

export async function getLists(scope: string | null, now: Date) {
  const today = istDate(now);
  const fileDate = (await latestFileDate(scope)) ?? today;
  const rows = await db
    .select({ loan: schema.loans, b: schema.borrowers, s: schema.scoreSnapshots })
    .from(schema.loans)
    .innerJoin(schema.borrowers, eq(schema.borrowers.id, schema.loans.borrowerId))
    .leftJoin(schema.scoreSnapshots, and(eq(schema.scoreSnapshots.loanId, schema.loans.id), eq(schema.scoreSnapshots.asOfDate, fileDate)))
    .where(and(eq(schema.loans.status, "overdue"), branchIs(schema.loans.branchId, scope)));
  const ids = rows.map((r) => r.loan.id);
  const promises = ids.length
    ? await db
        .select({ loanId: schema.promises.loanId, date: schema.promises.promisedDate, status: schema.promises.status })
        .from(schema.promises)
        .where(and(inArray(schema.promises.loanId, ids), inArray(schema.promises.status, ["open", "broken"]), gte(schema.promises.promisedDate, addDays(today, -14))))
        .orderBy(desc(schema.promises.createdAt))
    : [];
  const todays = ids.length
    ? await db
        .select({ loanId: schema.outcomes.loanId, type: schema.outcomes.type })
        .from(schema.outcomes)
        .where(and(inArray(schema.outcomes.loanId, ids), sql`${istDay(schema.outcomes.occurredAt)} = ${today}`))
        .orderBy(desc(schema.outcomes.occurredAt))
    : [];

  const loans: ListLoan[] = rows.map(({ loan, b, s }) => {
    const p = promises.find((x) => x.loanId === loan.id && x.status === "open") ?? promises.find((x) => x.loanId === loan.id);
    return {
      id: loan.id,
      branchId: loan.branchId,
      name: b.name,
      businessType: b.businessType,
      pincode: b.pincode,
      dpd: loan.dpd,
      overdue: overdueAmountOf(loan.emi, loan.dpd),
      outstanding: loan.outstanding,
      score: s?.score ?? 0,
      reasons: s?.reasons ?? [],
      limitedHistory: s?.limitedHistory ?? false,
      manualRank: loan.manualRank,
      assignmentReason: loan.assignmentReason,
      disputed: loan.disputed,
      promise: p ? { date: p.date, status: p.status } : null,
      todayOutcome: todays.find((x) => x.loanId === loan.id)?.type ?? null,
      officerId: loan.assignedOfficerId,
    };
  });
  loans.sort(compareForList);
  const officers = await getOfficerStats(scope, now);
  return {
    fileDate,
    officers: officers.map((o) => ({ ...o, loans: loans.filter((l) => l.officerId === o.id) })),
    unassigned: loans.filter((l) => !l.officerId),
  };
}

// ---------------------------------------------------------------------------------------------
// Promises
// ---------------------------------------------------------------------------------------------
export async function getPromiseTracker(scope: string | null, now: Date) {
  const today = istDate(now);
  const rows = await db
    .select({
      id: schema.promises.id,
      loanId: schema.promises.loanId,
      date: schema.promises.promisedDate,
      amount: schema.promises.amount,
      status: schema.promises.status,
      createdAt: schema.promises.createdAt,
      resolvedAt: schema.promises.resolvedAt,
      borrower: schema.borrowers.name,
      officer: schema.users.name,
      officerId: schema.users.id,
      branchId: schema.loans.branchId,
      dpd: schema.loans.dpd,
      loanStatus: schema.loans.status,
    })
    .from(schema.promises)
    .innerJoin(schema.loans, eq(schema.loans.id, schema.promises.loanId))
    .innerJoin(schema.borrowers, eq(schema.borrowers.id, schema.loans.borrowerId))
    .innerJoin(schema.users, eq(schema.users.id, schema.promises.officerId))
    .where(and(gte(schema.promises.promisedDate, addDays(today, -14)), inArray(schema.promises.status, ["open", "kept", "broken"]), branchIs(schema.loans.branchId, scope)))
    .orderBy(asc(schema.promises.promisedDate));

  // Reminders sent for these promises' loans in the window (mock outbox).
  const loanIds = [...new Set(rows.map((r) => r.loanId))];
  const reminders = loanIds.length
    ? await db
        .select({ loanId: schema.messages.loanId, status: schema.messages.status, at: schema.messages.occurredAt })
        .from(schema.messages)
        .where(and(inArray(schema.messages.loanId, loanIds), gte(schema.messages.occurredAt, new Date(now.getTime() - 14 * 86_400_000))))
    : [];
  const withReminder = rows.map((r) => ({
    ...r,
    reminded: reminders.some((m) => m.loanId === r.loanId && m.status === "sent_simulated" && istDate(m.at) >= istDate(r.createdAt)),
  }));
  const brokenByOfficer = new Map<string, { name: string; broken: number; kept: number }>();
  for (const r of withReminder.filter((x) => x.status !== "open")) {
    const e = brokenByOfficer.get(r.officerId) ?? { name: r.officer, broken: 0, kept: 0 };
    r.status === "broken" ? e.broken++ : e.kept++;
    brokenByOfficer.set(r.officerId, e);
  }
  return {
    today,
    dueToday: withReminder.filter((r) => r.status === "open" && r.date === today),
    upcoming: withReminder.filter((r) => r.status === "open" && r.date > today),
    overdueOpen: withReminder.filter((r) => r.status === "open" && r.date < today),
    broken: withReminder.filter((r) => r.status === "broken").reverse(),
    kept: withReminder.filter((r) => r.status === "kept").reverse(),
    byOfficer: [...brokenByOfficer.values()].sort((a, b) => b.broken - a.broken),
  };
}

// ---------------------------------------------------------------------------------------------
// Weekly back-test
// ---------------------------------------------------------------------------------------------
export type BacktestWeek = {
  scoredOn: ISODate;
  n: number;
  paidRate: number;
  auc: number | null;
  /** Share not paid among the top fifth by score, and among everyone else. */
  topFifthNotPaid: number | null;
  restNotPaid: number | null;
  bands: { label: string; n: number; predicted: number; notPaid: number }[];
};

function auc(rows: { score: number; positive: boolean }[]): number | null {
  const pos = rows.filter((r) => r.positive).length;
  const neg = rows.length - pos;
  if (pos === 0 || neg === 0) return null;
  const sorted = [...rows].sort((a, b) => a.score - b.score);
  let sumPos = 0;
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j < sorted.length && sorted[j].score === sorted[i].score) j++;
    const avg = (i + 1 + j) / 2; // average rank for ties
    for (let k = i; k < j; k++) if (sorted[k].positive) sumPos += avg;
    i = j;
  }
  return (sumPos - (pos * (pos + 1)) / 2) / (pos * neg);
}

/**
 * Compares each Monday's scores with what happened in the next 7 days.
 * "Paid" = the loan left the overdue file within 7 days, or the officer logged a payment.
 * A useful score ranks the loans that did not pay above the ones that did.
 */
export async function getBacktest(scope: string | null, fileDate: ISODate, weeks = 4): Promise<BacktestWeek[]> {
  const lastMonday = weekStart(addDays(fileDate, -7));
  const mondays = Array.from({ length: weeks }, (_, i) => addDays(lastMonday, -7 * (weeks - 1 - i)));
  const result: BacktestWeek[] = [];
  for (const d of mondays) {
    const scored = await db
      .select({ loanId: schema.scoreSnapshots.loanId, score: schema.scoreSnapshots.score, p: schema.scoreSnapshots.pRoll })
      .from(schema.scoreSnapshots)
      .innerJoin(schema.loans, eq(schema.loans.id, schema.scoreSnapshots.loanId))
      .where(and(eq(schema.scoreSnapshots.asOfDate, d), branchIs(schema.loans.branchId, scope)));
    if (scored.length === 0) continue;
    const ids = scored.map((s) => s.loanId);
    const stillOverdue = new Set(
      (
        await db
          .select({ id: schema.loanSnapshots.loanId })
          .from(schema.loanSnapshots)
          .where(and(eq(schema.loanSnapshots.asOfDate, addDays(d, 7)), inArray(schema.loanSnapshots.loanId, ids)))
      ).map((r) => r.id),
    );
    const paidLogged = new Set(
      (
        await db
          .selectDistinct({ id: schema.outcomes.loanId })
          .from(schema.outcomes)
          .where(
            and(
              inArray(schema.outcomes.loanId, ids),
              eq(schema.outcomes.type, "paid"),
              sql`${istDay(schema.outcomes.occurredAt)} >= ${d}`,
              sql`${istDay(schema.outcomes.occurredAt)} < ${addDays(d, 7)}`,
              sql`coalesce(${schema.outcomes.reason}, '') <> 'partial'`,
            ),
          )
      ).map((r) => r.id),
    );
    const rows = scored.map((s) => ({ ...s, positive: stillOverdue.has(s.loanId) && !paidLogged.has(s.loanId) }));
    const sortedDesc = [...rows].sort((a, b) => b.score - a.score);
    const cut = Math.ceil(rows.length / 5);
    const top = sortedDesc.slice(0, cut);
    const rest = sortedDesc.slice(cut);
    const share = (list: typeof rows) => (list.length ? list.filter((r) => r.positive).length / list.length : null);
    const bands = [
      [0, 19],
      [20, 39],
      [40, 59],
      [60, 79],
      [80, 100],
    ].map(([lo, hi]) => {
      const inBand = rows.filter((r) => r.score >= lo && r.score <= hi);
      return {
        label: `${lo}–${hi}`,
        n: inBand.length,
        predicted: inBand.length ? inBand.reduce((s, r) => s + r.p, 0) / inBand.length : 0,
        notPaid: inBand.length ? inBand.filter((r) => r.positive).length / inBand.length : 0,
      };
    });
    result.push({
      scoredOn: d,
      n: rows.length,
      paidRate: rows.filter((r) => !r.positive).length / rows.length,
      auc: auc(rows.map((r) => ({ score: r.p, positive: r.positive }))),
      topFifthNotPaid: share(top),
      restNotPaid: share(rest),
      bands,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// Activity and audit
// ---------------------------------------------------------------------------------------------
export async function getActivity(scope: string | null, date: ISODate, officerId?: string | null) {
  const officerFilter = officerId ? eq(schema.outcomes.officerId, officerId) : sql`true`;
  const visits = await db
    .select({
      id: schema.outcomes.id,
      at: schema.outcomes.occurredAt,
      syncedAt: schema.outcomes.syncedAt,
      type: schema.outcomes.type,
      channel: schema.outcomes.channel,
      reason: schema.outcomes.reason,
      amount: schema.outcomes.amount,
      lat: schema.outcomes.lat,
      lng: schema.outcomes.lng,
      accuracy: schema.outcomes.accuracyM,
      gps: schema.outcomes.gpsStatus,
      flags: schema.outcomes.flags,
      loanId: schema.outcomes.loanId,
      borrower: schema.borrowers.name,
      bLat: schema.borrowers.lat,
      bLng: schema.borrowers.lng,
      officer: schema.users.name,
      officerId: schema.users.id,
    })
    .from(schema.outcomes)
    .innerJoin(schema.loans, eq(schema.loans.id, schema.outcomes.loanId))
    .innerJoin(schema.borrowers, eq(schema.borrowers.id, schema.loans.borrowerId))
    .innerJoin(schema.users, eq(schema.users.id, schema.outcomes.officerId))
    .where(and(sql`${istDay(schema.outcomes.occurredAt)} = ${date}`, branchIs(schema.loans.branchId, scope), officerFilter))
    .orderBy(desc(schema.outcomes.occurredAt));
  const blocked = await db
    .select({
      id: schema.contactAttempts.id,
      at: schema.contactAttempts.occurredAt,
      kind: schema.contactAttempts.kind,
      reason: schema.contactAttempts.blockedReason,
      flags: schema.contactAttempts.flags,
      loanId: schema.contactAttempts.loanId,
      borrower: schema.borrowers.name,
      officer: schema.users.name,
    })
    .from(schema.contactAttempts)
    .innerJoin(schema.loans, eq(schema.loans.id, schema.contactAttempts.loanId))
    .innerJoin(schema.borrowers, eq(schema.borrowers.id, schema.loans.borrowerId))
    .innerJoin(schema.users, eq(schema.users.id, schema.contactAttempts.officerId))
    .where(and(eq(schema.contactAttempts.allowed, false), gte(schema.contactAttempts.occurredAt, new Date(`${addDays(date, -6)}T00:00:00+05:30`)), branchIs(schema.loans.branchId, scope)))
    .orderBy(desc(schema.contactAttempts.occurredAt))
    .limit(50);
  return { visits, blocked };
}

export async function getAudit(scope: string | null, limit = 80) {
  // Branch managers see entries by people in their branch; the head sees everything.
  const rows = await db
    .select({ a: schema.auditLog, name: schema.users.name, branchId: schema.users.branchId })
    .from(schema.auditLog)
    .leftJoin(schema.users, eq(schema.users.id, schema.auditLog.actorId))
    .where(scope ? eq(schema.users.branchId, scope) : sql`true`)
    .orderBy(desc(schema.auditLog.at))
    .limit(limit);
  return rows;
}

export async function getImports(scope: string | null) {
  return db
    .select({ i: schema.imports, by: schema.users.name, role: schema.users.role, branchId: schema.users.branchId })
    .from(schema.imports)
    .leftJoin(schema.users, eq(schema.users.id, schema.imports.uploadedBy))
    .where(scope ? sql`(${schema.users.branchId} = ${scope} or ${schema.users.role} = 'head')` : sql`true`)
    .orderBy(desc(schema.imports.createdAt))
    .limit(10);
}

// ---------------------------------------------------------------------------------------------
// Loan detail
// ---------------------------------------------------------------------------------------------
export async function getLoanDetail(loanId: string, scope: string | null) {
  const [row] = await db
    .select({ loan: schema.loans, b: schema.borrowers, officer: schema.users.name })
    .from(schema.loans)
    .innerJoin(schema.borrowers, eq(schema.borrowers.id, schema.loans.borrowerId))
    .leftJoin(schema.users, eq(schema.users.id, schema.loans.assignedOfficerId))
    .where(and(eq(schema.loans.id, loanId), branchIs(schema.loans.branchId, scope)));
  if (!row) return null;
  const [scores, outcomes, promises, attempts, messages, snapshots, officers] = await Promise.all([
    db.select().from(schema.scoreSnapshots).where(eq(schema.scoreSnapshots.loanId, loanId)).orderBy(desc(schema.scoreSnapshots.asOfDate)).limit(30),
    db
      .select({ o: schema.outcomes, officer: schema.users.name })
      .from(schema.outcomes)
      .innerJoin(schema.users, eq(schema.users.id, schema.outcomes.officerId))
      .where(eq(schema.outcomes.loanId, loanId))
      .orderBy(desc(schema.outcomes.occurredAt))
      .limit(30),
    db.select().from(schema.promises).where(eq(schema.promises.loanId, loanId)).orderBy(desc(schema.promises.createdAt)).limit(10),
    db.select().from(schema.contactAttempts).where(eq(schema.contactAttempts.loanId, loanId)).orderBy(desc(schema.contactAttempts.occurredAt)).limit(20),
    db.select().from(schema.messages).where(eq(schema.messages.loanId, loanId)).orderBy(desc(schema.messages.occurredAt)).limit(10),
    db.select().from(schema.loanSnapshots).where(eq(schema.loanSnapshots.loanId, loanId)).orderBy(asc(schema.loanSnapshots.asOfDate)),
    db
      .select({ id: schema.users.id, name: schema.users.name })
      .from(schema.users)
      .where(and(eq(schema.users.role, "officer"), eq(schema.users.active, true), eq(schema.users.branchId, row.loan.branchId))),
  ]);
  return { ...row, scores, outcomes, promises, attempts, messages, snapshots, officers };
}

export async function unassignedCount(scope: string | null) {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.loans)
    .where(and(eq(schema.loans.status, "overdue"), isNull(schema.loans.assignedOfficerId), branchIs(schema.loans.branchId, scope)));
  return r?.n ?? 0;
}
