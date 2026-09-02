-- 0000 · extensions and roles (hand-written; ADR-004, ADR-013).
-- Runs as the migrator (schema owner). Idempotent: re-running is a no-op.

-- Platform extensions verified by packages/testing (PostGIS, pgvector, trigram search).
CREATE EXTENSION IF NOT EXISTS postgis;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint

-- eia_app: GROUP role for the application runtime (web + worker). It never logs in; login roles
-- are provisioned outside migrations (`pnpm db:provision-runtime-role`) and inherit from it.
-- No superuser, no BYPASSRLS, no DDL: every request is subject to Row Level Security.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eia_app') THEN
    CREATE ROLE eia_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT;
  END IF;
END
$$;
--> statement-breakpoint

-- eia_policy: owner of the SECURITY DEFINER helper functions used inside RLS policies
-- (membership lookups). It bypasses RLS ONLY inside those functions, which take ids as
-- parameters and read the current user from the transaction-local setting; it cannot log in and
-- is never granted to any login role.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eia_policy') THEN
    CREATE ROLE eia_policy NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT;
  END IF;
END
$$;
