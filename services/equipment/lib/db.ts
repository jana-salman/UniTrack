import { EquipmentConfigurationError } from "./service-errors";
import "server-only";

import { Pool } from "pg";

declare global {
  var unitrackEquipmentPgPool: Pool | undefined;
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString?.trim()) {
    throw new EquipmentConfigurationError("database");
  }

  return new Pool({
    connectionString,
    max: 3,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

export function getDatabasePool(): Pool {
  globalThis.unitrackEquipmentPgPool ??= createPool();
  return globalThis.unitrackEquipmentPgPool;
}
