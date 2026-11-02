import { NextResponse } from "next/server";
import { assertSameOrigin, destroySession, getSessionUser } from "@/server/auth/session";
import { audit, clientIp } from "@/server/audit";
import { handle } from "@/server/http";

export const POST = handle(async (request: Request) => {
  await assertSameOrigin(request);
  const user = await getSessionUser();
  if (user) await audit(user, "auth.logout", { type: "user", id: user.id }, {}, { ip: clientIp(request) });
  await destroySession();
  return NextResponse.json({ redirect: "/login" });
});
