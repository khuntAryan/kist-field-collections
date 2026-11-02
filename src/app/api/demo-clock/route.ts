import { NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { requireApiUser, HttpError } from "@/server/auth/session";
import { DEMO_CLOCK_COOKIE, demoMode } from "@/server/clock";
import { audit } from "@/server/audit";
import { handle, readJson } from "@/server/http";

const body = z.object({ time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable() });

/** Reviewer-only: pin the time of day to try the 8 am - 7 pm block. Disabled outside demo mode. */
export const POST = handle(async (request: Request) => {
  if (!demoMode()) throw new HttpError(404, "not_found");
  const user = await requireApiUser(request, ["officer", "manager", "head"]);
  const { time } = body.parse(await readJson(request, 1000));
  const jar = await cookies();
  if (time) jar.set(DEMO_CLOCK_COOKIE, time, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 6 * 3600 });
  else jar.delete(DEMO_CLOCK_COOKIE);
  await audit(user, "demo.clock_set", null, { time });
  return NextResponse.json({ ok: true, time });
});
