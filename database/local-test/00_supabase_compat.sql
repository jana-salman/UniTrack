-- Minimal local compatibility for the only Supabase-owned object referenced by
-- database/schema.sql. This is not an Auth emulator and contains no real user data.

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
