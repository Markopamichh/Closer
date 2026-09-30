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

## Working agreement (with Marko)

- Act as tech lead and mentor: be direct, flag bad ideas, explain trade-offs (not basics).
- Plan first for each week; wait for approval before implementing.
- Before each step, say what and why; after it, summarize files touched and the decision taken (and the rejected alternative). Pause for an OK after every numbered point.
- Announce every skill used and why. Verify tests with mutation checks: commit first, assert the mutation actually applied, then restore.
- Run `pnpm format:check` as its own command before committing (never piped through `tail`).
- Keep this project outside iCloud-synced folders (Desktop/Documents): sync creates `* 2` duplicates that corrupt `node_modules` and the Next.js cache.

## Current status (Week 2)

Decisions: embeddings via Voyage AI `voyage-4` (1024 dims, plain `fetch`), Supabase Storage (local disk driver in dev/tests), PDF + DOCX + TXT/MD, BullMQ worker as a separate process, dark mode with `next-themes`, i18n EN/ES with `next-intl` (browser detection + selector, cookie, no locale in URL).

1. [x] Infra: Redis, env, storage adapters, embedding providers
2. [x] Inventory CRUD (per-vertical attributes, kind immutable)
3. [x] CSV import (all-or-nothing, dry run, upsert by external_id)
4. [x] Document ingestion (extract → chunk → embed, worker, retries)
5. [ ] Semantic search — in progress: `documentsRepo.searchChunks` written (iterative HNSW scan, same-model filter); next: `searchKnowledge` service, `GET /documents/search` (before `/:documentId`), embedder in `AppDeps`, tests (incl. filtered-HNSW starvation case)
6. [ ] Dark mode + EN/ES
7. [ ] Web: Inventory page
8. [ ] Web: Knowledge page
9. [ ] Close: full checks, `security-review`, docs

Pending outside the code: apply migration `0002` to Supabase (project `jtbrswpmnjvgkmiydvrq`), enable login for `closer_app` there, add `VOYAGE_API_KEY` to `.env`.

## Testing

- Tests run against a real Postgres, in a separate `<db>_test` database created and migrated by `apps/api/test/global-setup.ts`.
- Tenant isolation is tested per layer: `isolation.api` (HTTP), `isolation.repo` (repository without RLS), `isolation.rls` (raw SQL as `closer_app` on every tenant table found in the catalog).
- A new tenant table must be seeded in `isolation.rls.test.ts`; the suite fails until it is.
- New tenant routes need cross-tenant cases in `isolation.api.test.ts`.

## Before production

- Wire an email provider; set `requireEmailVerification: true` (invitations already require a verified email).
- Replace logged verification/invitation links with real emails.
- Bundle the API (e.g. tsup/esbuild) instead of running it with tsx.
- Trust `x-forwarded-for` only from the known proxy; move Better Auth rate limiting to shared storage when running more than one instance.

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

- [x] **Week 1**: monorepo, auth + organizations + roles, base Drizzle schema, CI, deployable skeleton
- [ ] **Week 2**: inventory CRUD + CSV import, document ingestion queue + embeddings
- [ ] **Week 3**: agent runtime with tool use + streaming, test chat in dashboard
- [ ] **Week 4**: embeddable widget, leads, human handoff, visit scheduling
- [ ] **Week 5**: AI traces panel, evals in CI, per-tenant rate limiting, Stripe (test mode) plans + usage metering
- [ ] **Week 6**: landing, 2 demo tenants (dealership + real estate), README with architecture diagram, demo video
