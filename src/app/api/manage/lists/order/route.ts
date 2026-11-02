import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { requireApiUser, HttpError } from "@/server/auth/session";
import { currentScope } from "@/server/scope";
import { db, schema } from "@/server/db";
import { compareForList } from "@/lib/scoring/score";
import { latestFileDate } from "@/server/queries/manage";
import { audit, clientIp } from "@/server/audit";
import { handle, readJson } from "@/server/http";

const body = z.object({
  loanId: z.string().regex(/^LN-\d{3,8}$/),
  action: z.enum(["top", "up", "down", "reset"]),
});

/**
 * Managers can override the AI order. Moving a loan freezes the order of everything above it
 * (so the move sticks when scores change tomorrow); "reset" hands the loan back to the score.
 */
export const POST = handle(async (request: Request) => {
  const user = await requireApiUser(request, ["manager", "head"]);
  const { loanId, action } = body.parse(await readJson(request, 1000));
  const scope = await currentScope(user);

  const [loan] = await db.select().from(schema.loans).where(eq(schema.loans.id, loanId));
  if (!loan || loan.status !== "overdue" || !loan.assignedOfficerId) throw new HttpError(404, "not_found", "Loan is not on any list.");
  if (scope && loan.branchId !== scope) throw new HttpError(403, "forbidden", "This loan is in another branch.");

  const fileDate = await latestFileDate(loan.branchId);
  const list = await db
    .select({ id: schema.loans.id, dpd: schema.loans.dpd, manualRank: schema.loans.manualRank, score: schema.scoreSnapshots.score })
    .from(schema.loans)
    .leftJoin(schema.scoreSnapshots, and(eq(schema.scoreSnapshots.loanId, schema.loans.id), eq(schema.scoreSnapshots.asOfDate, fileDate ?? "1970-01-01")))
    .where(and(eq(schema.loans.assignedOfficerId, loan.assignedOfficerId), eq(schema.loans.status, "overdue")));
  const ordered = list.map((l) => ({ ...l, score: l.score ?? 0 })).sort(compareForList);
  const i = ordered.findIndex((l) => l.id === loanId);

  let updates: { id: string; rank: number | null }[] = [];
  if (action === "reset") {
    updates = [{ id: loanId, rank: null }];
  } else {
    const target = action === "top" ? 0 : action === "up" ? Math.max(0, i - 1) : Math.min(ordered.length - 1, i + 1);
    const ids = ordered.map((l) => l.id);
    ids.splice(i, 1);
    ids.splice(target, 0, loanId);
    const freezeTo = Math.max(i, target);
    updates = ids.slice(0, freezeTo + 1).map((id, k) => ({ id, rank: k + 1 }));
  }
  await db.transaction(async (tx) => {
    for (const u of updates) {
      await tx.update(schema.loans).set({ manualRank: u.rank, manualRankBy: u.rank === null ? null : user.id }).where(eq(schema.loans.id, u.id));
    }
    await audit(user, "list.reorder", { type: "loan", id: loanId }, { action, officerId: loan.assignedOfficerId, from: i + 1 }, { tx, ip: clientIp(request) });
  });
  return NextResponse.json({ ok: true });
});
