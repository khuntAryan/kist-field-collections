import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { requireApiUser, HttpError } from "@/server/auth/session";
import { currentScope } from "@/server/scope";
import { db, schema } from "@/server/db";
import { now } from "@/server/clock";
import { audit, clientIp } from "@/server/audit";
import { handle, readJson } from "@/server/http";

const body = z.object({ officerId: z.uuid() });

export const POST = handle(async (request: Request, ctx: RouteContext<"/api/manage/loans/[id]/assign">) => {
  const user = await requireApiUser(request, ["manager", "head"]);
  const { id } = await ctx.params;
  const { officerId } = body.parse(await readJson(request, 500));
  const scope = await currentScope(user);

  const [loan] = await db.select().from(schema.loans).where(eq(schema.loans.id, id));
  if (!loan || loan.status !== "overdue") throw new HttpError(404, "not_found", "Loan not found or no longer overdue.");
  if (scope && loan.branchId !== scope) throw new HttpError(403, "forbidden", "This loan is in another branch.");
  const [officer] = await db
    .select()
    .from(schema.users)
    .where(and(eq(schema.users.id, officerId), eq(schema.users.role, "officer"), eq(schema.users.active, true)));
  if (!officer || officer.branchId !== loan.branchId) throw new HttpError(400, "bad_officer", "Pick an active officer from the loan's branch.");

  await db.transaction(async (tx) => {
    await tx
      .update(schema.loans)
      .set({ assignedOfficerId: officerId, assignmentReason: "manual", assignedAt: await now(), manualRank: null, manualRankBy: null })
      .where(eq(schema.loans.id, id));
    await audit(user, "loan.reassign", { type: "loan", id }, { from: loan.assignedOfficerId, to: officerId }, { tx, ip: clientIp(request) });
  });
  return NextResponse.json({ ok: true });
});
