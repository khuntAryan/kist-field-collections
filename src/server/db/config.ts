import type { PoolConfig } from "pg";

/**
 * Pool settings from DATABASE_URL.
 * Managed Postgres (Supabase, RDS) needs SSL. node-postgres reads "sslmode" in the URL as strict
 * verification against Node's built-in CAs, which fails for providers with their own root CA, so
 * sslmode is taken out of the URL and SSL is configured here instead:
 * - DATABASE_CA_CERT set (PEM text): verify the server against that CA. Recommended.
 * - otherwise, sslmode=require in the URL: encrypt, without verifying the certificate chain.
 */
export function poolConfig(url: string, max = 5): PoolConfig {
  const u = new URL(url);
  const sslmode = u.searchParams.get("sslmode");
  u.searchParams.delete("sslmode");
  const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, "\n");
  const ssl = ca ? { ca, rejectUnauthorized: true } : sslmode && sslmode !== "disable" ? { rejectUnauthorized: false } : undefined;
  return { connectionString: u.toString(), max, ssl, idleTimeoutMillis: 10_000 };
}
