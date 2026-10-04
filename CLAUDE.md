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
- Agent LLM: OpenAI (`openai` SDK), default model `gpt-5-nano` (cheapest: $0.05 in / $0.005 cached / $0.40 out per 1M tokens, checked 2026-10-01 on the official pricing page); per-agent `model` column, behind our own small LLM interface so tests use a scripted fake

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

## Role

Act as a staff-level software engineer (10+ years shipping production SaaS) and as tech lead and mentor to Marko, a 22-year-old freelance fullstack developer. Expertise: multi-tenant architecture, security and data isolation; TypeScript/Node backends, Postgres, queues and distributed systems; applied AI engineering (tool-using agents, RAG, evals, LLM observability); Next.js/React with product and UX judgment.

The goal is not just code: the result must make a US engineering manager think "this person knows what they're doing", and Marko must understand every decision well enough to defend it in a technical interview.

- Be direct. If an idea is bad or there is a better option, say so and explain why before doing it.
- Prefer simple, maintainable code over clever solutions. No over-engineering: if it doesn't add to the portfolio or the product, it doesn't go in.
- Think like the person who will maintain this in production: errors, edge cases, security, performance.
- Don't explain basics; do explain trade-offs and the why behind each decision.

## Skills

Announce every skill used (which one and why). This file wins over a skill; flag the conflict when it happens.

- `supabase-schema`, `db-audit`: schema/migration design and RLS/index audits. Our model wins: Drizzle migrations, RLS keyed on `app.org_id`, `closer_app` role (not `auth.uid()` or supabase-js).
- `spec-feature`, `grill-me`: shaping a feature or a week's plan before implementing.
- `ui-ux-pro-max`, `ui-styling`, `design-system`: web pages (Inventory, Knowledge, dashboard, landing), shadcn/Tailwind, theme tokens.
- `claude-api`: only if the agent moves to Claude. The agent runs on OpenAI (Marko's call: existing credits); verify OpenAI SDK usage, model ids and prices against the official docs, never from memory.
- `diagnose`: non-obvious bugs, before guessing at fixes.
- `security-review`, `code-review`, `simplify`, `code-audit`, `ts-check`: closing each week.
- `perf-check`: dashboard and query performance passes. `dataviz`: usage/traces charts (Week 5).
- `seo-audit`, `remove-ai-marks`: landing and README (Week 6). `remotion-best-practices`/`hyperframes`: demo video.
- Not used: `tdd-slice`, `sprint-run`, `ralph-loop`, `claude-config-init`, `conformance-suite` impose a separate methodology/scaffolding that conflicts with this repo's structure.

## Working agreement (with Marko)

- Plan first for each week; wait for approval before implementing.
- Before each step, say what and why; after it, summarize files touched and the decision taken (and the rejected alternative). Pause for an OK after every numbered point.
- Announce every skill used and why. Verify tests with mutation checks: commit first, assert the mutation actually applied, then restore. Run them in a throwaway `git worktree` under /tmp (copy `.env`, delete it after): mutating files under a running `pnpm dev` leaves broken modules in its cache.
- Run `pnpm format:check` as its own command before committing (never piped through `tail`).
- Keep this project outside iCloud-synced folders (Desktop/Documents): sync creates `* 2` duplicates that corrupt `node_modules` and the Next.js cache.

## Current status (Week 4 in progress)

**Week 4 plan (approved 2026-10-04):** 4.1 schema (agent widget fields: `widget_enabled`, rotatable `public_key`, `allowed_origins`, `timezone`; `visits` table; `closer_widget_lookup` SECURITY DEFINER so a public key resolves to its org without opening `agents`), 4.2 public widget chat API (cookieless SSE by public key; shared agent-run service with the test chat; visitor id must match to continue a conversation; per-visitor + per-org limits and a per-org **daily message cap**, pulled forward from Week 5), 4.3 embed (`/embed/[publicKey]` iframe served by Next with CSP `frame-ancestors` from `allowed_origins`, small loader script, Widget section on the Agent page), 4.4 leads (`save_lead` tool, the first write tool, limited to its own conversation's lead; Leads page), 4.5 human handoff (`request_human` stops the AI; human replies from Conversations; widget polls while handed off), 4.6 visits (`book_visit` creates a request in the org's timezone; team confirms/cancels; no external calendar), 4.7 close. Decisions: iframe over a Shadow-DOM script (no CORS, browser-enforced embedding, reuses React/Tailwind/i18n); polling over WebSockets for human replies.

- [x] 4.1 Schema: migration `0006` (apply to Supabase). drizzle-kit ordered the `inventory_items (id, org_id)` unique after the FK needing it; moved by hand in the SQL.
- [x] 4.2 Public widget chat: `POST /api/public/widget/:publicKey/chat` (cookieless; unknown/malformed/disabled key = same 404; continue only with the same visitor id, widget channel, same agent). Reply loop shared in `agent/reply.ts`. Quotas, all fail-closed: per-org 20/min and **500/day shared by test chat + widget** (`chat-daily:<org>`, a rolling 24h window from the first message, not a calendar day), per-visitor 6/min (fairness only: the visitor id is client-chosen). No IP limit: behind the Next proxy the API sees one IP until `x-forwarded-for` is trusted (see Before production).
- [x] 4.3 Embed: widget settings in the agent PATCH (origins normalized to `scheme://host[:port]`; paths, credentials, wildcards and other schemes rejected because they end up in CSP), `POST /agents/:id/widget/rotate-key`, public `GET /api/public/widget/:key`. Web: `/embed/[publicKey]` with per-widget `frame-ancestors 'self' <origins>` set in `src/proxy.ts`; every other page sends `frame-ancestors 'none'` + `X-Frame-Options: DENY` (the dashboard had no clickjacking protection before). `public/widget.js` loader (lazy iframe, close only via postMessage from that iframe). Streaming chat state shared in `useAgentChat`. Agent page: time zone field, Widget card (origins, snippet, preview, rotate key). `packages/widget` is still an unused skeleton: the loader is plain JS served by Next.

## Week 3 (done)

**Week 3 closed (2026-10-03):** OpenAI agent loop with read-only tenant-bound tools, cached policy prefix, SSE test chat (persisted, traced with exact cost, metered, rate-limited fail-closed), Agent page verified by Marko in a real browser, own theme provider (dropped `next-themes`). Checks + build green (464 tests), `security-review` found nothing exploitable.

**3.7 Conversations (2026-10-02, missed at first close):** read-only `GET /conversations` (latest activity first, agent/channel filters) and `/conversations/:id` (thread, tool calls without output, per-reply and total cost), any role; Conversations page (master-detail, `?c=` deep link, native `<details>` for tool calls). Per-reply cost lives in `messages.metadata.costUsd` (replies before 2026-10-02 have none); add a `message_id` FK on `ai_traces` only if the Week 5 traces panel needs the join. Replying as a human and changing status come with the Week 4 handoff. Isolation cases added; `security-review` found nothing.

Carry into Week 4/5:

- Week 4 (widget): design CORS + CSRF together (explicit Origin checks) when cross-origin requests start; today CSRF rests on SameSite=Lax cookies + JSON-only bodies.
- Week 5: per-org daily spend budget (today only 20 messages/min); trace tokens of completed rounds when the client aborts mid-reply; evals for `gpt-5-nano` quality and the literal `search_inventory` query (semantic inventory search if evals show misses).
- If the dashboard throws "API /api/me failed with 500": the API's `/health` reports `database: unreachable` when Docker is down. Run `colima start && docker compose up -d`.

Week 3 plan (approved 2026-10-01): 3.1 LLM client interface + OpenAI adapter + manual tool loop (max 5 tool rounds, abort on client disconnect, append-only history), 3.2 read-only tools (`search_inventory`, `get_inventory_item`, `search_knowledge`; org from the conversation, Zod-validated input, documents treated as untrusted), 3.3 stable cached prompt prefix, 3.4 SSE test-chat API with messages/tool_calls/ai_traces persistence, `ai_message` usage and per-org rate limit, 3.5 Agent page (config + streaming test chat), 3.6 close, 3.7 Conversations page. Week 5: evals decide whether `gpt-5-nano` is good enough (candidates: `gpt-6-luna`, `gpt-5.6-luna`).

Decisions: embeddings via Voyage AI `voyage-4` (1024 dims, plain `fetch`), Supabase Storage (local disk driver in dev/tests), PDF + DOCX + TXT/MD, BullMQ worker as a separate process, dark mode with our own theme provider (was `next-themes`, dropped for React 19.3's script warning), i18n EN/ES with `next-intl` (browser detection + selector, cookie, no locale in URL).

1. [x] Infra: Redis, env, storage adapters, embedding providers
2. [x] Inventory CRUD (per-vertical attributes, kind immutable)
3. [x] CSV import (all-or-nothing, dry run, upsert by external_id)
4. [x] Document ingestion (extract → chunk → embed, worker, retries)
5. [x] Semantic search (`GET /documents/search`): exact scan for tenants up to 10k chunks, HNSW + iterative scan above; same-model filter; chunks exist only while searchable (deleted on failed ingestion, kept during re-processing); query tokens metered
6. [x] Dark mode + EN/ES (cookie > Accept-Language > en; key parity and typed keys enforced by typecheck). API error messages are still English: translate by error code when forms get richer
7. [x] Web: Inventory page (URL filters + pagination, create/edit dialog per kind, CSV import with dry-run preview, owner-only delete; web has Vitest for pure logic)
8. [x] Web: Knowledge page (upload with client checks, auto-refresh only while processing, reprocess/delete, client-side "test your knowledge" search so refreshes never re-bill embeddings)
9. [x] Close: build/lint/typecheck/tests green, two `security-review` passes (no findings), inventory DTO, per-org search rate limit (30/min, fail-open), README

Supabase (project `jtbrswpmnjvgkmiydvrq`) is set up: migrations `0000`–`0005` applied (pgvector 0.8.2), `closer_app` login enabled and verified under RLS, private `documents` bucket verified with the real adapter. Credentials live in the git-ignored `.env.supabase` (`set -a; source .env.supabase; set +a` before `pnpm db:migrate`); local dev and tests keep using Docker via `.env`. Still pending: add a payment method to Voyage before demos (free tier is 3 requests/min).

## Testing

- Tests run against a real Postgres, in a separate `<db>_test` database created and migrated by `apps/api/test/global-setup.ts`.
- Tenant isolation is tested per layer: `isolation.api` (HTTP), `isolation.repo` (repository without RLS), `isolation.rls` (raw SQL as `closer_app` on every tenant table found in the catalog).
- A new tenant table must be seeded in `isolation.rls.test.ts`; the suite fails until it is.
- New tenant routes need cross-tenant cases in `isolation.api.test.ts`.

## Before production

- Wire an email provider; set `requireEmailVerification: true` (invitations already require a verified email).
- Replace logged verification/invitation links with real emails.
- Bundle the API (e.g. tsup/esbuild) instead of running it with tsx.
- Make the search rate limit (hardcoded 30/min in `apps/api/src/index.ts`) configurable per plan (Week 5).
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
- [x] **Week 2**: inventory CRUD + CSV import, document ingestion queue + embeddings
- [x] **Week 3**: agent runtime with tool use + streaming, test chat in dashboard
- [ ] **Week 4**: embeddable widget, leads, human handoff, visit scheduling
- [ ] **Week 5**: AI traces panel, evals in CI, per-tenant rate limiting, Stripe (test mode) plans + usage metering
- [ ] **Week 6**: landing, 2 demo tenants (dealership + real estate), README with architecture diagram, demo video
