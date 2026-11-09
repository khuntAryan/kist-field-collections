/**
 * Hourly top-up for the live demo: plays the other officers' field work forward to "now", so a
 * reviewer who opens the manager screens at any hour sees a working day in progress.
 *
 * - Runs only on a demo database whose overdue file is today's (the nightly reset loads it).
 * - Leaves the demo officer (Rahul, the one-tap officer account) alone, so a reviewer signed in
 *   as him never sees entries appear on his list that he did not make.
 * - Self-correcting: each officer's day has a fixed target (7 to 10 contacts); a run adds only
 *   what is due by now, so missed or late runs catch up and repeated runs add nothing.
 *
 * Usage: npm run demo:tick
 */
import "./env";
import { and, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "../src/server/db";
import { istDate, istDateTime, istParts } from "../src/lib/time";
import { createRng } from "./sim/rng";
import { FIELD_END_MIN, FIELD_START_MIN, playFieldWork } from "./sim/field-day";
import { OFFICERS, email } from "./sim/world";

const DEMO_OFFICER = "rahul";

/** Stable number from text, so each officer's daily target is the same on every run. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

async function main() {
  const now = new Date();
  const today = istDate(now);
  const nowMin = istParts(now).minuteOfDay;

  if (new Date(`${today}T00:00:00Z`).getUTCDay() === 0) return console.log("Sunday: no field work.");
  const toMin = Math.min(nowMin - 5, FIELD_END_MIN);
  if (toMin <= FIELD_START_MIN) return console.log("Before field hours: nothing to add.");

  const [{ fileDate }] = (await db.execute(sql`select max(last_import_date)::text as "fileDate" from loans`)).rows as { fileDate: string | null }[];
  if (fileDate !== today) return console.log(`Latest overdue file is ${fileDate ?? "none"}, not today (${today}). Run the nightly reset (npm run db:seed) first.`);

  const fraction = (toMin - FIELD_START_MIN) / (FIELD_END_MIN - FIELD_START_MIN);
  const dayStart = istDateTime(today, 0, 0);
  let added = 0;
  for (const o of OFFICERS) {
    if (o.key === DEMO_OFFICER) continue;
    const officer = await db.query.users.findFirst({ where: (u, { eq: e }) => e(u.email, email(o.key)) });
    if (!officer || !officer.active) continue;

    const target = createRng(hash(`${today}:${o.key}`)).int(7, 10);
    const due = Math.round(fraction * target);
    const [stats] = (
      await db
        .select({ done: sql<number>`count(*)::int`, lastEpoch: sql<number | null>`extract(epoch from max(${schema.outcomes.occurredAt}))::float8` })
        .from(schema.outcomes)
        .where(and(eq(schema.outcomes.officerId, officer.id), gte(schema.outcomes.occurredAt, dayStart)))
    );
    const lastMin = stats.lastEpoch !== null ? istParts(new Date(stats.lastEpoch * 1000)).minuteOfDay : FIELD_START_MIN - 1;
    const fromMin = Math.max(FIELD_START_MIN, lastMin + 1);
    const n = due - stats.done;
    if (n <= 0 || fromMin >= toMin) continue;

    const rng = createRng(hash(`${now.toISOString()}:${o.key}`));
    const accepted = await playFieldWork({ officerId: officer.id, day: today, fromMin, toMin, count: n, rng, now });
    added += accepted;
    console.log(`${o.name}: +${accepted} (${stats.done + accepted}/${target} for the day)`);
  }
  console.log(`Added ${added} contacts for ${today}, up to ${Math.floor(toMin / 60)}:${String(toMin % 60).padStart(2, "0")} IST.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
