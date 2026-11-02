import "server-only";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { schema, type DB } from "../db";
import { evaluatePromise } from "@/lib/promises";
import { istDate, type ISODate } from "@/lib/time";

/**
 * Settles promises at import time.
 * - A loan that left the overdue file has paid up: its open promise is kept.
 * - Other open promises whose date has passed are checked against logged payments:
 *   kept if they add up to 90% of the promise, otherwise broken.
 */
export async function settlePromises(tx: DB, asOf: ISODate, curedLoanIds: string[], at: Date) {
  if (curedLoanIds.length > 0) {
    await tx
      .update(schema.promises)
      .set({ status: "kept", resolvedAt: at })
      .where(and(eq(schema.promises.status, "open"), inArray(schema.promises.loanId, curedLoanIds)));
  }

  const due = await tx
    .select()
    .from(schema.promises)
    .where(and(eq(schema.promises.status, "open"), lt(schema.promises.promisedDate, asOf)));
  if (due.length === 0) return { kept: 0, broken: 0 };

  const payments = await tx
    .select({
      loanId: schema.outcomes.loanId,
      amount: schema.outcomes.amount,
      date: sql<string>`(${schema.outcomes.occurredAt} at time zone 'Asia/Kolkata')::date::text`,
    })
    .from(schema.outcomes)
    .where(and(eq(schema.outcomes.type, "paid"), inArray(schema.outcomes.loanId, [...new Set(due.map((p) => p.loanId))])));

  let kept = 0;
  let broken = 0;
  for (const p of due) {
    const state = evaluatePromise(
      { madeOn: istDate(p.createdAt), promisedDate: p.promisedDate, amount: p.amount },
      payments.filter((x) => x.loanId === p.loanId).map((x) => ({ date: x.date, amount: x.amount ?? 0 })),
      asOf,
    );
    if (state === "open") continue;
    state === "kept" ? kept++ : broken++;
    await tx.update(schema.promises).set({ status: state, resolvedAt: at }).where(eq(schema.promises.id, p.id));
  }
  return { kept, broken };
}
