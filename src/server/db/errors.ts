/**
 * Recognises "the database is not ready" failures (no tables yet, unreachable, wrong password)
 * so the app can say so plainly instead of returning a generic server error.
 */
export type DbProblem = "not_migrated" | "unreachable" | "wrong_password" | "ssl";

export function dbProblem(err: unknown): DbProblem | null {
  const seen = new Set<unknown>();
  let e: unknown = err;
  while (e && typeof e === "object" && !seen.has(e)) {
    seen.add(e);
    const code = (e as { code?: unknown }).code;
    const msg = String((e as { message?: unknown }).message ?? "");
    if (code === "42P01") return "not_migrated"; // undefined_table
    if (code === "28P01" || code === "28000") return "wrong_password";
    if (["ETIMEDOUT", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ECONNRESET", "EHOSTUNREACH"].includes(String(code))) return "unreachable";
    if (/self[- ]signed certificate|certificate/i.test(msg)) return "ssl";
    const agg = (e as { errors?: unknown[] }).errors;
    if (Array.isArray(agg) && agg.length) {
      const inner = dbProblem(agg[0]);
      if (inner) return inner;
    }
    e = (e as { cause?: unknown }).cause;
  }
  return null;
}

export const DB_PROBLEM_MESSAGE: Record<DbProblem, string> = {
  not_migrated: "The database has no tables yet. Run npm run db:migrate and npm run db:seed against it.",
  unreachable: "The app cannot reach its database right now. Check DATABASE_URL and that the database is running.",
  wrong_password: "The database refused the password in DATABASE_URL.",
  ssl: "The database connection failed its SSL check. Add ?sslmode=require to DATABASE_URL.",
};
