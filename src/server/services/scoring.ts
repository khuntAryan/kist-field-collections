import "server-only";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { schema, type DB } from "../db";
import { addDays, daysBetween, type ISODate } from "@/lib/time";
import { scoreLoan, type ScoreResult } from "@/lib/scoring/score";
import type { ScoreInput } from "@/lib/scoring/features";

type LoanForScoring = {
  id: string;
  dpd: number;
  outstanding: number;
  lastPaymentDate: string | null;
  paidRatio6m: number | null;
};

/** Builds model inputs for a set of loans from their promise and contact history. */
export async function buildScoreInputs(tx: DB, loans: LoanForScoring[], asOf: ISODate): Promise<Map<string, ScoreInput>> {
  const ids = loans.map((l) => l.id);
  const result = new Map<string, ScoreInput>();
  if (ids.length === 0) return result;

  const broken = await tx
    .select({ loanId: schema.promises.loanId, n: sql<number>`count(*)::int` })
    .from(schema.promises)
    .where(
      and(
        inArray(schema.promises.loanId, ids),
        eq(schema.promises.status, "broken"),
        gte(schema.promises.promisedDate, addDays(asOf, -90)),
      ),
    )
    .groupBy(schema.promises.loanId);

  const unreachable = await tx
    .select({ loanId: schema.outcomes.loanId, n: sql<number>`count(*)::int` })
    .from(schema.outcomes)
    .where(
      and(
        inArray(schema.outcomes.loanId, ids),
        eq(schema.outcomes.type, "not_reachable"),
        sql`(${schema.outcomes.occurredAt} at time zone 'Asia/Kolkata')::date >= ${addDays(asOf, -7)}::date`,
        sql`(${schema.outcomes.occurredAt} at time zone 'Asia/Kolkata')::date < ${asOf}::date`,
      ),
    )
    .groupBy(schema.outcomes.loanId);

  const upcoming = await tx
    .select({ loanId: schema.promises.loanId, date: sql<string>`min(${schema.promises.promisedDate})::text` })
    .from(schema.promises)
    .where(
      and(
        inArray(schema.promises.loanId, ids),
        eq(schema.promises.status, "open"),
        gte(schema.promises.promisedDate, asOf),
      ),
    )
    .groupBy(schema.promises.loanId);

  const brokenBy = new Map(broken.map((r) => [r.loanId, r.n]));
  const unreachableBy = new Map(unreachable.map((r) => [r.loanId, r.n]));
  const upcomingBy = new Map(upcoming.map((r) => [r.loanId, r.date]));

  for (const l of loans) {
    result.set(l.id, {
      dpd: l.dpd,
      outstanding: l.outstanding,
      brokenPromises90d: brokenBy.get(l.id) ?? 0,
      paidRatio6m: l.paidRatio6m,
      daysSinceLastPayment: l.lastPaymentDate ? Math.max(0, daysBetween(l.lastPaymentDate, asOf)) : null,
      unreachable7d: unreachableBy.get(l.id) ?? 0,
      upcomingPromiseDate: upcomingBy.get(l.id) ?? null,
    });
  }
  return result;
}

export async function scoreLoans(tx: DB, loans: LoanForScoring[], asOf: ISODate): Promise<Map<string, ScoreResult>> {
  const inputs = await buildScoreInputs(tx, loans, asOf);
  return new Map([...inputs].map(([id, input]) => [id, scoreLoan(input)]));
}

/** Saves today's scores so the weekly back-test can compare them with what happened. */
export async function saveScores(tx: DB, scores: Map<string, ScoreResult>, asOf: ISODate) {
  const rows = [...scores].map(([loanId, s]) => ({
    loanId,
    asOfDate: asOf,
    score: s.score,
    pRoll: s.pRoll,
    reasons: s.reasons,
    limitedHistory: s.limitedHistory,
    modelVersion: s.modelVersion,
  }));
  for (let i = 0; i < rows.length; i += 500) {
    await tx
      .insert(schema.scoreSnapshots)
      .values(rows.slice(i, i + 500))
      .onConflictDoUpdate({
        target: [schema.scoreSnapshots.loanId, schema.scoreSnapshots.asOfDate],
        set: {
          score: sql`excluded.score`,
          pRoll: sql`excluded.p_roll`,
          reasons: sql`excluded.reasons`,
          limitedHistory: sql`excluded.limited_history`,
          modelVersion: sql`excluded.model_version`,
        },
      });
  }
}

