import "server-only";

import { Pool } from "pg";

declare global {
  var unitrackPgPool: Pool | undefined;
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is required for server-side database access.");
  }

  return new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

export function getDatabasePool(): Pool {
  globalThis.unitrackPgPool ??= createPool();
  return globalThis.unitrackPgPool;
}

// Compatibility: older code imports { pool } from "@/lib/db".
// It is the same shared pool as getDatabasePool(), created only when first used,
// so importing this file never fails when DATABASE_URL is missing (for example
// during the build). New code should call getDatabasePool().
export const pool: Pool = new Proxy({} as Pool, {
  get(_target, property) {
    const realPool = getDatabasePool();
    const value = Reflect.get(realPool, property, realPool);
    return typeof value === "function" ? value.bind(realPool) : value;
  },
});