import "server-only";
import { and, desc, eq, gte, inArray, max, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { compareForList } from "@/lib/scoring/score";
import { addDays, istDate } from "@/lib/time";
import type { ScoreReasonJson } from "../db/schema";

export type OfficerLoan = {
  id: string;
  name: string;
  businessType: string;
  contactName: string;
  phone: string;
  address: string;
  pincode: string;
  lat: number | null;
  lng: number | null;
  language: "hi" | "en";
  outstanding: number;
  emi: number;
  dpd: number;
  overdueAmount: number;
  score: number;
  pRoll: number;
  reasons: ScoreReasonJson[];
  limitedHistory: boolean;
  movedByManager: boolean;
  disputed: boolean;
  promise: { date: string; amount: number; status: "open" | "broken" | "kept" } | null;
  history: { id: string; type: string; channel: string; reason: string | null; amount: number | null; promisedDate: string | null; at: string }[];
  today: { type: string; at: string } | null;
};

export type OfficerDay = {
  serverNow: string;
  businessDate: string;
  fileDate: string | null;
  demoMode: boolean;
  demoClock: string | null;
  officer: { id: string; name: string; branchName: string; language: "hi" | "en" };
  loans: OfficerLoan[];
  templates: { id: string; purpose: string; language: string; body: string }[];
};

export const overdueAmountOf = (emi: number, dpd: number) => emi * Math.max(1, Math.ceil(dpd / 30));

/** Everything the phone needs for the day, so it can work with no signal. */
export async function getOfficerDay(officerId: string, now: Date, demo: { mode: boolean; clock: string | null }): Promise<OfficerDay> {
  const today = istDate(now);
  const [officer] = await db
    .select({ id: schema.users.id, name: schema.users.name, language: schema.users.language, branchName: schema.branches.name, branchId: schema.users.branchId })
    .from(schema.users)
    .leftJoin(schema.branches, eq(schema.branches.id, schema.users.branchId))
    .where(eq(schema.users.id, officerId));

  const rows = await db
    .select({ loan: schema.loans, b: schema.borrowers })
    .from(schema.loans)
    .innerJoin(schema.borrowers, eq(schema.borrowers.id, schema.loans.borrowerId))
    .where(and(eq(schema.loans.assignedOfficerId, officerId), eq(schema.loans.status, "overdue")));

  const ids = rows.map((r) => r.loan.id);
  const [{ fileDate }] = await db
    .select({ fileDate: max(schema.loans.lastImportDate) })
    .from(schema.loans)
    .where(officer?.branchId ? eq(schema.loans.branchId, officer.branchId) : sql`true`);

  const scores = ids.length
    ? await db
        .select()
        .from(schema.scoreSnapshots)
        .where(and(inArray(schema.scoreSnapshots.loanId, ids), eq(schema.scoreSnapshots.asOfDate, fileDate ?? today)))
    : [];
  const promises = ids.length
    ? await db
        .select()
        .from(schema.promises)
        .where(and(inArray(schema.promises.loanId, ids), inArray(schema.promises.status, ["open", "broken", "kept"]), gte(schema.promises.promisedDate, addDays(today, -14))))
        .orderBy(desc(schema.promises.createdAt))
    : [];
  const history = ids.length
    ? await db
        .select()
        .from(schema.outcomes)
        .where(and(inArray(schema.outcomes.loanId, ids), gte(schema.outcomes.occurredAt, new Date(now.getTime() - 45 * 86_400_000))))
        .orderBy(desc(schema.outcomes.occurredAt))
    : [];
  const templates = await db
    .select({ id: schema.messageTemplates.id, purpose: schema.messageTemplates.purpose, language: schema.messageTemplates.language, body: schema.messageTemplates.body })
    .from(schema.messageTemplates)
    .where(eq(schema.messageTemplates.active, true));

  const scoreOf = new Map(scores.map((s) => [s.loanId, s]));
  const loans: OfficerLoan[] = rows.map(({ loan, b }) => {
    const s = scoreOf.get(loan.id);
    const p = promises.find((x) => x.loanId === loan.id && x.status === "open") ?? promises.find((x) => x.loanId === loan.id);
    const h = history.filter((x) => x.loanId === loan.id);
    const todayOutcome = h.find((x) => istDate(x.occurredAt) === today);
    return {
      id: loan.id,
      name: b.name,
      businessType: b.businessType,
      contactName: b.contactName,
      phone: b.phone,
      address: b.address,
      pincode: b.pincode,
      lat: b.lat,
      lng: b.lng,
      language: b.language === "en" ? "en" : "hi",
      outstanding: loan.outstanding,
      emi: loan.emi,
      dpd: loan.dpd,
      overdueAmount: overdueAmountOf(loan.emi, loan.dpd),
      score: s?.score ?? 0,
      pRoll: s?.pRoll ?? 0,
      reasons: s?.reasons ?? [],
      limitedHistory: s?.limitedHistory ?? loan.paidRatio6m === null,
      movedByManager: loan.manualRank !== null,
      disputed: loan.disputed,
      promise: p ? { date: p.promisedDate, amount: p.amount, status: p.status as "open" | "broken" | "kept" } : null,
      history: h.slice(0, 6).map((x) => ({
        id: x.id,
        type: x.type,
        channel: x.channel,
        reason: x.reason,
        amount: x.amount,
        promisedDate: x.promisedDate,
        at: x.occurredAt.toISOString(),
      })),
      today: todayOutcome ? { type: todayOutcome.type, at: todayOutcome.occurredAt.toISOString() } : null,
      _rank: loan.manualRank,
    } as OfficerLoan & { _rank: number | null };
  });

  loans.sort((a, b) =>
    compareForList(
      { id: a.id, score: a.score, dpd: a.dpd, manualRank: (a as OfficerLoan & { _rank: number | null })._rank },
      { id: b.id, score: b.score, dpd: b.dpd, manualRank: (b as OfficerLoan & { _rank: number | null })._rank },
    ),
  );
  for (const l of loans) delete (l as Partial<OfficerLoan & { _rank: number | null }>)._rank;

  return {
    serverNow: now.toISOString(),
    businessDate: today,
    fileDate: fileDate ?? null,
    demoMode: demo.mode,
    demoClock: demo.clock,
    officer: {
      id: officer.id,
      name: officer.name,
      branchName: officer.branchName ?? "",
      language: officer.language === "en" ? "en" : "hi",
    },
    loans,
    templates,
  };
}
