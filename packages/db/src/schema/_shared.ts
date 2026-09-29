import { sql } from "drizzle-orm";
import { pgPolicy, pgRole, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Runtime role used by the API. It does NOT have BYPASSRLS, so every policy below
 * applies to it. Created in the setup migration (drizzle/0000_setup.sql).
 */
export const closerApp = pgRole("closer_app").existing();

export const id = () => uuid().primaryKey().defaultRandom();

export const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/**
 * Row-level isolation for tenant tables: rows are only visible/writable when their
 * org_id matches the `app.org_id` setting of the current transaction (see withTenant).
 * If the setting is missing, `closer_current_org_id()` returns NULL and nothing matches.
 */
export const tenantIsolationPolicy = () =>
  pgPolicy("tenant_isolation", {
    as: "permissive",
    for: "all",
    to: closerApp,
    // Wrapped in a subselect so Postgres evaluates it once per query, not once per row.
    using: sql`org_id = (select closer_current_org_id())`,
    withCheck: sql`org_id = (select closer_current_org_id())`,
  });

/**
 * Identity tables (users, sessions, organizations, memberships...) are read across orgs
 * by Better Auth and by membership checks, so they are not org-scoped. RLS is still
 * enabled so Supabase's public roles (anon, authenticated) get no access at all.
 */
export const appOnlyPolicy = () =>
  pgPolicy("app_only", {
    as: "permissive",
    for: "all",
    to: closerApp,
    using: sql`true`,
    withCheck: sql`true`,
  });
