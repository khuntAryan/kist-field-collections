import { NextResponse } from "next/server";
import { requireApiUser } from "@/server/auth/session";
import { now } from "@/server/clock";
import { applySync } from "@/server/services/sync";
import { syncRequest, type SyncResponse } from "@/lib/sync-protocol";
import { clientIp } from "@/server/audit";
import { handle, readJson } from "@/server/http";

export const POST = handle(async (request: Request) => {
  const user = await requireApiUser(request, ["officer"]);
  const input = syncRequest.parse(await readJson(request, 2_000_000));
  const serverNow = await now();
  const results = await applySync(user, input, serverNow, clientIp(request));
  const body: SyncResponse = { serverNow: serverNow.toISOString(), results };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
});
