import "server-only";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type DB = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { kistPool?: Pool };

function createPool() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
  return new Pool({
    connectionString: url,
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    ssl: url.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
  });
}

const pool = globalForDb.kistPool ?? createPool();
if (process.env.NODE_ENV !== "production") globalForDb.kistPool = pool;

export const db: DB = drizzle(pool, { schema });
export { schema };
