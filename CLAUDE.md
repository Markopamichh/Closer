# Closer

Multi-tenant SaaS: a business (car dealership, real estate agency, etc.) uploads its inventory and documents and gets an embeddable AI sales-agent widget. The agent answers with real data via tools, qualifies leads, books visits and hands off to a human. Owners see conversations, leads, AI traces and usage in a dashboard.

Portfolio project: code quality, architecture decisions and docs matter as much as features.

## Stack

- Monorepo: Turborepo + pnpm workspaces
- `apps/web`: Next.js (App Router), Tailwind, shadcn/ui — dashboard + landing
- `apps/api`: Hono on Node — **all business logic lives here**
- `packages/db`: Drizzle ORM schema, migrations, typed client. Postgres (Supabase) + pgvector
- `packages/shared`: Zod schemas and types shared by api and web
- `packages/ai`: agent runtime, tools, prompts (skeleton)
- `packages/widget`: embeddable chat widget (skeleton)
- `packages/config`: shared tsconfig, eslint, prettier
- Auth: Better Auth + organization plugin (roles: `owner`, `agent`, `viewer`)
- Validation: Zod · Tests: Vitest · Logging: pino (JSON) · CI: GitHub Actions
- Later: BullMQ + Redis, Claude API (tool use, SSE streaming)

## Conventions

- TypeScript strict everywhere. `any` is forbidden (use `unknown` + narrowing).
- Zod validates every input boundary (HTTP bodies/params/query, env vars, external APIs).
- Every tenant table has `org_id` (FK to `organizations`, indexed) and `created_at`/`updated_at`.
- Tenant isolation has two layers; never rely on RLS alone:
  1. API queries go through the tenant-scoped repository (`createTenantRepo` / `withTenant`), which always filters by `org_id`.
  2. Postgres RLS policies keyed on `app.org_id`; the API connects as the non-bypass role `closer_app`.
- `org_id` comes from the route + verified membership, never from the request body.
- Non-member access to an org returns 404 (don't leak existence); insufficient role returns 403.
- No business logic in Next.js route handlers; web talks to the API.
- The `agent` **role** is a human team member; the `agents` **table** is the AI sales agent config.
- Conventional commits, in English. Small, logical commits.
- Code, comments and docs in English. Talk to the user in Spanish.
- Ask before adding dependencies not already in the repo.

## Commands

```bash
pnpm dev          # web (:3000) + api (:4000)
pnpm build
pnpm test
pnpm lint
pnpm typecheck
pnpm db:generate  # generate Drizzle migration from schema
pnpm db:migrate   # apply migrations
docker compose up -d  # local Postgres + pgvector
```

## Roadmap

- [ ] **Week 1**: monorepo, auth + organizations + roles, base Drizzle schema, CI, deployable skeleton
- [ ] **Week 2**: inventory CRUD + CSV import, document ingestion queue + embeddings
- [ ] **Week 3**: agent runtime with tool use + streaming, test chat in dashboard
- [ ] **Week 4**: embeddable widget, leads, human handoff, visit scheduling
- [ ] **Week 5**: AI traces panel, evals in CI, per-tenant rate limiting, Stripe (test mode) plans + usage metering
- [ ] **Week 6**: landing, 2 demo tenants (dealership + real estate), README with architecture diagram, demo video
