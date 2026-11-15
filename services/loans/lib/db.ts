import { LoansConfigurationError } from "./errors";
import "server-only";

import { Pool } from "pg";

declare global {
  var unitrackLoansPgPool: Pool | undefined;
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString?.trim()) {
    throw new LoansConfigurationError("database");
  }

  // The return Saga holds a PostgreSQL SESSION advisory lock across commits.
  // A transaction-mode pooler can switch backends and invalidate that guarantee.
  // Require explicit operator acknowledgement of a direct/session-pooled URL.
  if (process.env.LOANS_DATABASE_SESSION_AFFINITY !== "confirmed") {
    throw new LoansConfigurationError("session affinity");
  }

  return new Pool({
    connectionString,
    max: 3,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

export function getDatabasePool(): Pool {
  globalThis.unitrackLoansPgPool ??= createPool();
  return globalThis.unitrackLoansPgPool;
}
