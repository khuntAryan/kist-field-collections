/**
 * Simulated field work for one officer over part of a day, sent through the same sync service
 * the phones use (so contact-window checks, promises and the audit trail all apply).
 * Used by the seed for "today so far" and by the hourly demo top-up (scripts/demo-tick.ts).
 */
import { randomUUID } from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "../../src/server/db";
import { applySync } from "../../src/server/services/sync";
import { compareForList } from "../../src/lib/scoring/score";
import { addDays, istDateTime, type ISODate } from "../../src/lib/time";
import type { Rng } from "./rng";

/** Officers are in the field from 9:15 am to 6:30 pm (minutes after midnight, IST). */
export const FIELD_START_MIN = 9 * 60 + 15;
export const FIELD_END_MIN = 18 * 60 + 30;

/** The brief's three sample loans keep exactly the history the brief describes. */
const SCRIPTED = new Set(["LN-10293", "LN-10871", "LN-11930"]);

export async function playFieldWork(opts: {
  officerId: string;
  day: ISODate;
  fromMin: number;
  toMin: number;
  count: number;
  rng: Rng;
  now: Date;
}): Promise<number> {
  const { officerId, day, fromMin, toMin, count, rng, now } = opts;
  if (count <= 0 || toMin <= fromMin) return 0;

  const dayStart = istDateTime(day, 0, 0);
  const [list, scores, touched] = await Promise.all([
    db
      .select({ loan: schema.loans, lat: schema.borrowers.lat, lng: schema.borrowers.lng })
      .from(schema.loans)
      .innerJoin(schema.borrowers, eq(schema.borrowers.id, schema.loans.borrowerId))
      .where(and(eq(schema.loans.assignedOfficerId, officerId), eq(schema.loans.status, "overdue"))),
    db.select({ loanId: schema.scoreSnapshots.loanId, score: schema.scoreSnapshots.score }).from(schema.scoreSnapshots).where(eq(schema.scoreSnapshots.asOfDate, day)),
    db.select({ loanId: schema.outcomes.loanId }).from(schema.outcomes).where(gte(schema.outcomes.occurredAt, dayStart)),
  ]);
  const scoreOf = new Map(scores.map((s) => [s.loanId, s.score]));
  const done = new Set(touched.map((t) => t.loanId));

  // Officers work down their list in order, skipping anyone already contacted today.
  const ordered = list
    .filter(({ loan }) => !SCRIPTED.has(loan.id) && !done.has(loan.id))
    .map(({ loan, lat, lng }) => ({ ...loan, lat, lng, score: scoreOf.get(loan.id) ?? 0 }))
    .sort(compareForList)
    .slice(0, count);

  const jitter = (v: number, spread: number) => v + (rng.next() - 0.5) * 2 * spread;
  const times = ordered.map(() => rng.int(fromMin, toMin)).sort((a, b) => a - b);
  const events = ordered.map((l, i) => {
    const at = istDateTime(day, Math.floor(times[i] / 60), times[i] % 60);
    const r = rng.next();
    const type = r < 0.22 ? "paid" : r < 0.6 ? "promise" : "not_reachable";
    const channel = rng.chance(0.6) ? "visit" : "call";
    const lat = l.lat ?? 22.72;
    const lng = l.lng ?? 75.86;
    return {
      id: randomUUID(),
      kind: "outcome",
      loanId: l.id,
      deviceTime: at.toISOString(),
      occurredAt: at.toISOString(),
      serverOffsetMs: 0,
      createdOffline: rng.chance(0.2),
      type,
      channel,
      reason: type === "not_reachable" ? rng.pick(["no_answer", "switched_off", "shop_closed"]) : type === "paid" ? "emi" : undefined,
      amount: type === "paid" || type === "promise" ? l.emi : undefined,
      promisedDate: type === "promise" ? addDays(day, rng.int(1, 6)) : undefined,
      gps:
        channel === "visit"
          ? { status: "ok", lat: jitter(lat, 0.0004), lng: jitter(lng, 0.0004), accuracy: rng.int(6, 30) }
          : { status: "ok", lat: jitter(lat, 0.02), lng: jitter(lng, 0.02), accuracy: rng.int(10, 60) },
    };
  });
  if (events.length === 0) return 0;

  const results = await applySync({ id: officerId, role: "officer" }, { clientNow: now.toISOString(), events }, now, null);

  // Phones sync seconds after logging, or much later when they were offline.
  for (const e of events) {
    const delayMs = e.createdOffline ? rng.int(15, 90) * 60_000 : rng.int(3, 60) * 1000;
    const syncedAt = new Date(Math.min(new Date(e.occurredAt).getTime() + delayMs, now.getTime()));
    await db.update(schema.outcomes).set({ syncedAt }).where(sql`id = ${e.id}`);
    await db.update(schema.contactAttempts).set({ syncedAt }).where(sql`id = ${e.id}`);
  }
  return results.filter((r) => r.status === "accepted").length;
}
