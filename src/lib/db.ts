/**
 * Server-only Neon Postgres client.
 * NEVER import this from client components.
 * NEVER put NEON_CONNECTION_STRING in NEXT_PUBLIC_*.
 */

import { neon } from "@neondatabase/serverless";

type Sql = ReturnType<typeof neon>;

let sqlSingleton: Sql | null = null;

export function isNeonConfigured(): boolean {
  const cs = process.env.NEON_CONNECTION_STRING?.trim();
  return Boolean(cs && cs.startsWith("postgres"));
}

/** Lazy Neon HTTP SQL client. Throws if env is missing/invalid. */
export function getSql(): Sql {
  if (sqlSingleton) return sqlSingleton;
  const cs = process.env.NEON_CONNECTION_STRING?.trim();
  if (!cs || !cs.startsWith("postgres")) {
    throw new Error("NEON_CONNECTION_STRING is not configured");
  }
  // Strip accidental quotes from Vercel paste
  const cleaned = cs.replace(/^["']|["']$/g, "");
  sqlSingleton = neon(cleaned);
  return sqlSingleton;
}
