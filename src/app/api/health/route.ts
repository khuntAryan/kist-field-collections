import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/server/db";
import { dbProblem, DB_PROBLEM_MESSAGE } from "@/server/db/errors";

export const dynamic = "force-dynamic";

/** Health check for deployments: is the database reachable, migrated and seeded? No secrets in the output. */
export async function GET() {
  const started = Date.now();
  try {
    const r = await db.execute(sql`select (select count(*) from users)::int as users, (select count(*) from loans where status = 'overdue')::int as overdue, (select max(last_import_date)::text from loans) as file_date`);
    const row = r.rows[0] as { users: number; overdue: number; file_date: string | null };
    const seeded = row.users > 0;
    return NextResponse.json(
      { ok: seeded, database: seeded ? "ok" : "empty", users: row.users, overdueLoans: row.overdue, fileDate: row.file_date, region: process.env.VERCEL_REGION ?? null, ms: Date.now() - started },
      { status: seeded ? 200 : 503, headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const problem = dbProblem(err) ?? "error";
    return NextResponse.json(
      { ok: false, database: problem, message: problem === "error" ? "Database check failed." : DB_PROBLEM_MESSAGE[problem], region: process.env.VERCEL_REGION ?? null },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
