import { UsersError } from "./errors";
import "server-only";

import { Pool } from "pg";

declare global {
  var unitrackUsersPgPool: Pool | undefined;
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString?.trim()) {
    throw new UsersError(503, "users_not_configured", "Users service is not configured.");
  }

  return new Pool({
    connectionString,
    max: 3,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

export function getDatabasePool(): Pool {
  globalThis.unitrackUsersPgPool ??= createPool();
  return globalThis.unitrackUsersPgPool;
}
