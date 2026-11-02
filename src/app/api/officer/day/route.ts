import { NextResponse } from "next/server";
import { requireApiUser } from "@/server/auth/session";
import { demoClockValue, demoMode, now } from "@/server/clock";
import { getOfficerDay } from "@/server/queries/officer";
import { handle } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = handle(async (request: Request) => {
  const user = await requireApiUser(request, ["officer"]);
  const day = await getOfficerDay(user.id, await now(), { mode: demoMode(), clock: await demoClockValue() });
  return NextResponse.json(day, { headers: { "Cache-Control": "no-store" } });
});
