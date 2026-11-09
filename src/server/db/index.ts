import "server-only";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { attachDatabasePool } from "@vercel/functions";
import * as schema from "./schema";
import { poolConfig } from "./config";

export type DB = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { kistPool?: Pool };

function createPool() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
  // On Vercel, many small function instances share the database's connection limit (about 15 on
  // Supabase's session pooler), so each keeps a smaller pool and closes idle connections sooner.
  const onVercel = Boolean(process.env.VERCEL);
  const max = Number(process.env.DATABASE_POOL_MAX ?? (onVercel ? 3 : 5));
  const pool = new Pool({ ...poolConfig(url, max), idleTimeoutMillis: onVercel ? 5_000 : 10_000 });
  // An idle connection dropped by the database or pooler must not crash the server.
  pool.on("error", (err) => console.error("Postgres idle client error:", err.message));
  // Keeps a Vercel instance alive until its idle connections are closed, so suspended instances
  // do not hold connections open. Does nothing outside Vercel.
  attachDatabasePool(pool);
  return pool;
}

const pool = globalForDb.kistPool ?? createPool();
if (process.env.NODE_ENV !== "production") globalForDb.kistPool = pool;

export const db: DB = drizzle(pool, { schema });
export { schema };
