# Closer

[![CI](https://github.com/Markopamichh/Closer/actions/workflows/ci.yml/badge.svg)](https://github.com/Markopamichh/Closer/actions/workflows/ci.yml)

Multi-tenant SaaS that gives any business — a car dealership, a real estate agency — an AI
sales agent for its website. The business uploads its inventory and documents; the agent
answers with real data through tools, qualifies leads, books visits and hands off to a human.

> **Status:** Week 1 of 6 — foundations (monorepo, auth, organizations and roles, full
> database schema, tenant isolation, CI). The full README with an architecture diagram and a
> demo lands in Week 6. See the roadmap in [`CLAUDE.md`](./CLAUDE.md).

## Stack

| Layer      | Tech                                                           |
| ---------- | -------------------------------------------------------------- |
| Monorepo   | Turborepo, pnpm workspaces                                     |
| Web        | Next.js (App Router), Tailwind CSS, shadcn/ui                  |
| API        | Hono on Node.js — all business logic lives here                |
| Database   | Postgres (Supabase) + pgvector, Drizzle ORM                    |
| Auth       | Better Auth with the organization plugin                       |
| Validation | Zod, shared between web and API                                |
| Quality    | TypeScript strict, ESLint (type-aware), Vitest, GitHub Actions |

```
apps/
  api/        Hono API: auth, organizations, tenant-scoped routes
  web/        Next.js dashboard (proxies /api/* to the API)
packages/
  db/         Drizzle schema, migrations, tenant-scoped repository
  shared/     Zod schemas and types used by both apps
  config/     Shared tsconfig, ESLint and Prettier
  ai/         Agent runtime (Week 3)
  widget/     Embeddable chat widget (Week 4)
```

## Tenant isolation

Every tenant table carries `org_id`. Isolation is enforced in layers, each tested on its own:

1. **Membership check** — `requireRole` resolves the caller's membership in the `:orgId` of
   the route. Not a member → `404` (indistinguishable from an org that doesn't exist); wrong
   role → `403`. The org id always comes from the route, never from the request body.
2. **Tenant-scoped repository** — `withTenant(db, orgId, repo => …)` exposes queries that
   always filter and stamp `org_id`.
3. **Row-level security** — the API connects as `closer_app`, a role _without_ `BYPASSRLS`.
   `withTenant` sets a transaction-local `app.org_id`, and every tenant table has a policy
   keyed on it. A query that forgot its filter still can't see another tenant's rows.
4. **Composite foreign keys** — children reference parents by `(id, org_id)`, so Postgres
   rejects a row that points at another tenant's data.

The test suite in [`apps/api/test`](./apps/api/test) proves each layer independently:
cross-tenant attacks through the HTTP API for every role, the repository on a connection
that bypasses RLS, and raw SQL as `closer_app` against every tenant table discovered from
the Postgres catalog.

## Local development

Requirements: Node.js ≥ 22, pnpm (via `corepack enable`), Docker with Compose.

```bash
cp .env.example .env
# set BETTER_AUTH_SECRET, e.g. with: openssl rand -base64 32

pnpm install
docker compose up -d   # Postgres 17 + pgvector on localhost:5433
pnpm db:migrate
pnpm dev               # web on :3000, API on :4000
```

Open http://localhost:3000, create an account and an organization.

There is no email provider yet: email-verification and invitation links are written to the
API logs (`email verification requested`, `invitation created`).

### Commands

| Command            | What it does                                        |
| ------------------ | --------------------------------------------------- |
| `pnpm dev`         | Web and API in watch mode                           |
| `pnpm test`        | Test suite (uses a separate `closer_test` database) |
| `pnpm lint`        | ESLint across the monorepo                          |
| `pnpm typecheck`   | TypeScript across the monorepo                      |
| `pnpm db:generate` | Generate a migration from schema changes            |
| `pnpm db:migrate`  | Apply pending migrations to `DATABASE_URL`          |

## Supabase setup

1. Create a project and copy the **Session pooler** connection string
   (Connect → Session pooler). Use it as `DATABASE_URL` and run `pnpm db:migrate`.
2. The migrations create the `closer_app` role without login. Enable it in the SQL editor
   with a password of your own:
   ```sql
   ALTER ROLE closer_app WITH LOGIN PASSWORD '<strong-password>';
   ```
3. Set `DATABASE_APP_URL` to the same pooler URL with user `closer_app.<project-ref>` and
   that password. The API must only ever use this connection.
