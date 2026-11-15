-- Minimal local compatibility for Supabase-owned objects and browser roles
-- referenced by the schema/isolation migrations. This is not an Auth emulator
-- and contains no real user data.

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;

CREATE SCHEMA auth;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY
);

DO $$
BEGIN
  IF to_regprocedure('gen_random_uuid()') IS NULL THEN
    RAISE EXCEPTION 'PostgreSQL gen_random_uuid() is required by database/schema.sql';
  END IF;
END;
$$;
