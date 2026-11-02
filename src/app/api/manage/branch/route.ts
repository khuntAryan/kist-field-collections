import { NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { requireApiUser } from "@/server/auth/session";
import { BRANCH_COOKIE } from "@/server/scope";
import { getBranches } from "@/server/queries/manage";
import { handle, readJson } from "@/server/http";

const body = z.object({ branch: z.string().max(10) });

export const POST = handle(async (request: Request) => {
  await requireApiUser(request, ["head"]);
  const { branch } = body.parse(await readJson(request, 500));
  const valid = branch === "all" || (await getBranches()).some((b) => b.id === branch);
  const jar = await cookies();
  if (!valid || branch === "all") jar.delete(BRANCH_COOKIE);
  else jar.set(BRANCH_COOKIE, branch, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 30 * 86400 });
  return NextResponse.json({ ok: true });
});
