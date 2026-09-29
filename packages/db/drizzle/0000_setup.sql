-- Extensions, runtime role and helpers that the schema migrations depend on.

CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint

-- Runtime role for the API. NOBYPASSRLS is the whole point: RLS policies apply to it.
-- It is created without LOGIN here; each environment enables login with its own
-- password outside of version control (see README / docker/init.sql).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'closer_app') THEN
    CREATE ROLE closer_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO closer_app;
--> statement-breakpoint
-- Tables and sequences created by later migrations (run by the owner) are granted automatically.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO closer_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO closer_app;
--> statement-breakpoint

-- Current tenant for RLS policies. Returns NULL when `app.org_id` is unset or empty,
-- so a query without tenant context matches no rows instead of failing open.
CREATE OR REPLACE FUNCTION closer_current_org_id() RETURNS uuid
  LANGUAGE sql STABLE
  SET search_path = ''
  AS $$ SELECT nullif(pg_catalog.current_setting('app.org_id', true), '')::uuid $$;
