import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "../db";

export type Role = "officer" | "manager" | "head";
export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  branchId: string | null;
  language: "hi" | "en";
};

export const SESSION_COOKIE = "kist_session";
const SESSION_HOURS = 12;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set to at least 32 characters.");
  return new TextEncoder().encode(s);
}

export async function createSession(user: { id: string; role: Role }) {
  const token = await new SignJWT({ role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(secret());
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
}

export async function destroySession() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Reads the cookie and re-loads the user, so a deactivated account loses access at once. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  let userId: string;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (!payload.sub) return null;
    userId = payload.sub;
  } catch {
    return null; // expired, tampered or signed with another secret: treat as signed out
  }
  // A database error is not "signed out": let it surface as a 503 or the error page, so a brief
  // outage does not send people to the sign-in screen or tell officers to sign in again.
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!u || !u.active) return null;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    branchId: u.branchId,
    language: u.language === "en" ? "en" : "hi",
  };
}

export function homeFor(role: Role) {
  return role === "officer" ? "/app" : "/manage";
}

/** For pages: sends people who are not signed in to the sign-in page, and wrong roles home. */
export async function requirePageUser(roles: Role[]): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!roles.includes(user.role)) redirect(homeFor(user.role));
  return user;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

/** For API routes: 401 when signed out, 403 for the wrong role, and a same-origin check on writes. */
export async function requireApiUser(request: Request, roles: Role[]): Promise<SessionUser> {
  if (request.method !== "GET" && request.method !== "HEAD") await assertSameOrigin(request);
  const user = await getSessionUser();
  if (!user) throw new HttpError(401, "signed_out", "Sign in again to continue.");
  if (!roles.includes(user.role)) throw new HttpError(403, "forbidden", "Your role cannot do this.");
  return user;
}

/** CSRF protection on top of SameSite=Lax cookies: writes must come from our own pages. */
export async function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return; // same-origin fetches from older browsers may omit it; SameSite still applies
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host || new URL(origin).host !== host) throw new HttpError(403, "bad_origin", "Request came from another site.");
}

/** Branch scope: managers see their branch, the head of collections sees all. */
export function branchScope(user: SessionUser, requested?: string | null): string | null {
  if (user.role === "head") return requested && requested !== "all" ? requested : null;
  if (!user.branchId) throw new HttpError(403, "no_branch", "This account has no branch.");
  return user.branchId;
}
