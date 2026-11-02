import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { verifyPassword } from "@/server/auth/password";
import { assertSameOrigin, createSession, homeFor } from "@/server/auth/session";
import { audit, clientIp } from "@/server/audit";
import { handle, readJson } from "@/server/http";

const body = z.object({
  email: z.email().max(120).transform((v) => v.trim().toLowerCase()),
  password: z.string().min(1).max(200),
});

const MAX_FAILS = 5;
const LOCK_MINUTES = 10;
const WRONG = { error: "wrong_credentials", message: "Email or password is wrong." };

export const POST = handle(async (request: Request) => {
  await assertSameOrigin(request);
  const { email, password } = body.parse(await readJson(request, 10_000));
  const ip = clientIp(request);
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);

  if (!user || !user.active) {
    await audit(null, "auth.login_failed", null, { email, reason: "unknown" }, { ip });
    return NextResponse.json(WRONG, { status: 401 });
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
    return NextResponse.json(
      { error: "locked", message: `Too many wrong attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` },
      { status: 429 },
    );
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    const fails = user.failedLogins + 1;
    await db
      .update(schema.users)
      .set({
        failedLogins: fails >= MAX_FAILS ? 0 : fails,
        lockedUntil: fails >= MAX_FAILS ? sql`now() + interval '${sql.raw(String(LOCK_MINUTES))} minutes'` : null,
      })
      .where(eq(schema.users.id, user.id));
    await audit({ id: user.id, role: user.role }, "auth.login_failed", { type: "user", id: user.id }, { attempts: fails }, { ip });
    return NextResponse.json(WRONG, { status: 401 });
  }

  await db.update(schema.users).set({ failedLogins: 0, lockedUntil: null }).where(eq(schema.users.id, user.id));
  await createSession({ id: user.id, role: user.role });
  await audit({ id: user.id, role: user.role }, "auth.login", { type: "user", id: user.id }, {}, { ip });
  return NextResponse.json({ redirect: homeFor(user.role) });
});
