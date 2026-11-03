import { Pool } from "pg";

// One shared connection pool. DATABASE_URL comes from the .env file
// (never commit it). JS gives you the real value for Supabase.
const globalForPg = globalThis as unknown as { pgPool?: Pool };

export const pool =
  globalForPg.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }, // Supabase needs SSL
  });

if (process.env.NODE_ENV !== "production") globalForPg.pgPool = pool;