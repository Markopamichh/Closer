# Closer

[![CI](https://github.com/Markopamichh/Closer/actions/workflows/ci.yml/badge.svg)](https://github.com/Markopamichh/Closer/actions/workflows/ci.yml)

Multi-tenant SaaS that gives any business — a car dealership, a real estate agency — an AI
sales agent for its website. The business uploads its inventory and documents; the agent
answers with real data through tools, qualifies leads, books visits and hands off to a human.

> **Status:** Week 2 of 6 done. Foundations (auth, organizations and roles, tenant
> isolation, CI) plus the business's data: inventory with CSV import, document ingestion
> into a vector index, semantic search, and the dashboard pages for both (EN/ES, dark mode).
> Next: the agent itself, with tool use and streaming. The full README with an architecture
> diagram and a demo lands in Week 6. See the roadmap in [`CLAUDE.md`](./CLAUDE.md).

## Stack

| Layer      | Tech                                                           |
| ---------- | -------------------------------------------------------------- |
| Monorepo   | Turborepo, pnpm workspaces                                     |
| Web        | Next.js (App Router), Tailwind CSS, shadcn/ui                  |
| API        | Hono on Node.js — all business logic lives here                |
| Database   | Postgres (Supabase) + pgvector, Drizzle ORM                    |
| Jobs       | BullMQ + Redis (document ingestion worker)                     |
| AI         | Voyage AI embeddings (`voyage-4`, 1024 dims)                   |
| Auth       | Better Auth with the organization plugin                       |
| Validation | Zod, shared between web and API                                |
| Quality    | TypeScript strict, ESLint (type-aware), Vitest, GitHub Actions |

```
apps/
  api/        Hono API (tenant-scoped routes) and the ingestion worker
  web/        Next.js dashboard (proxies /api/* to the API), EN/ES, dark mode
packages/
  db/         Drizzle schema, migrations, tenant-scoped repository
  shared/     Zod schemas and types used by both apps
  config/     Shared tsconfig, ESLint and Prettier
  ai/         Embedding providers and chunking; agent runtime (Week 3)
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

## Knowledge pipeline

Owners upload PDF, DOCX, TXT or Markdown files; the agent answers from them.

1. **Upload**: the API detects the type from the file's bytes rather than its extension,
   stores it under `<orgId>/<documentId>`, creates a `pending` row and enqueues a job that
   carries only ids. The request never parses the file.
2. **Ingestion worker** (separate process): extracts text, splits it into overlapping chunks,
   embeds them, and in one transaction replaces the document's chunks and marks it `ready`.
   Retries are idempotent. Permanent failures (unreadable file, rejected API key) fail fast
   with a readable reason; transient ones (rate limits, provider outages) are retried with
   backoff.
3. **Search**: the query is embedded and compared by cosine distance, scoped to the org and
   to chunks produced by the same embedding model.
   - Tenants with up to 10k chunks get an **exact scan**. HNSW is approximate, and another
     tenant's near-duplicate chunks can crowd a small tenant out of the candidate set.
     An exact scan costs about 3 ms per 1k vectors.
   - Larger tenants use **HNSW with pgvector 0.8's iterative scan**.
   - Each query's tokens are metered per org.
   - A per-org rate limit (30 searches per minute) caps the cost of paid embeddings.

Chunks are exactly a document's searchable content. A re-index keeps the previous chunks
searchable until they are atomically replaced; a failed job deletes them with the status.

## Local development

Requirements: Node.js ≥ 22, pnpm (via `corepack enable`), Docker with Compose.

```bash
cp .env.example .env
# set BETTER_AUTH_SECRET, e.g. with: openssl rand -base64 32

pnpm install
docker compose up -d   # Postgres 17 + pgvector on :5433, Redis on :6380
pnpm db:migrate
pnpm dev               # web on :3000, API on :4000, ingestion worker
```

Open http://localhost:3000, create an account and an organization.

Without `VOYAGE_API_KEY`, an offline fake embedder is used: search then matches shared words,
not meaning, and the dashboard says so. Uploaded files go to `LOCAL_STORAGE_DIR`.

There is no email provider yet: email-verification and invitation links are written to the
API logs (`email verification requested`, `invitation created`).

### Commands

| Command            | What it does                                       |
| ------------------ | -------------------------------------------------- |
| `pnpm dev`         | Web, API and worker in watch mode                  |
| `pnpm build`       | Production build                                   |
| `pnpm test`        | Test suites (API uses a separate `closer_test` DB) |
| `pnpm lint`        | ESLint across the monorepo                         |
| `pnpm typecheck`   | TypeScript across the monorepo                     |
| `pnpm db:generate` | Generate a migration from schema changes           |
| `pnpm db:migrate`  | Apply pending migrations to `DATABASE_URL`         |

## Supabase setup

1. Create a project and copy the **Session pooler** connection string
   (Connect → Session pooler). Use it as `DATABASE_URL` and run `pnpm db:migrate`.
   Search needs pgvector 0.8 or newer: a migration aborts with a clear message
   otherwise (upgrade it under Database → Extensions).
2. The migrations create the `closer_app` role without login. Enable it in the SQL editor
   with a password of your own:
   ```sql
   ALTER ROLE closer_app WITH LOGIN PASSWORD '<strong-password>';
   ```
3. Set `DATABASE_APP_URL` to the same pooler URL with user `closer_app.<project-ref>` and
   that password. The API must only ever use this connection.
4. For file storage, create a private bucket and set `STORAGE_DRIVER=supabase`,
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server-side only, never exposed to the web)
   and `STORAGE_BUCKET`.
