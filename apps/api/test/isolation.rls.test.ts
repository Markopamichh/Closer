/**
 * Layer 2 in isolation: Postgres row-level security.
 *
 * Raw SQL as `closer_app` (the API's runtime role) with NO org_id filter in the queries,
 * i.e. what would happen if application code forgot to scope a query. Tenant tables are
 * discovered from the catalog, so a new table is covered automatically — and if it is
 * not seeded below or lacks a policy, these tests fail.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ownerUrl = process.env.DATABASE_URL ?? "";
const appUrl = process.env.DATABASE_APP_URL ?? "";

/** Identity tables carry org_id but are read across orgs (membership checks, Better Auth). */
const IDENTITY_TABLES_WITH_ORG_ID = ["invitations", "memberships"];

const owner = postgres(ownerUrl, { max: 2, onnotice: () => undefined });
const app = postgres(appUrl, { max: 2, onnotice: () => undefined });

const TENANT_TABLES = (
  await owner<{ table: string }[]>`
    select c.relname as table
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'org_id' and not a.attisdropped
    where n.nspname = 'public' and c.relkind = 'r'
      and c.relname <> all(${IDENTITY_TABLES_WITH_ORG_ID})
    order by c.relname`
).map((r) => r.table);

let orgA = "";
let orgB = "";

class Rollback extends Error {}

/**
 * Runs `fn` as closer_app inside a transaction that is always rolled back.
 * `orgId === null` means "no tenant context", as if withTenant had been skipped.
 */
async function asApp<T>(orgId: string | null, fn: (tx: postgres.TransactionSql) => Promise<T>) {
  let result: T | undefined;
  try {
    await app.begin(async (tx) => {
      if (orgId !== null) await tx`select set_config('app.org_id', ${orgId}, true)`;
      result = await fn(tx);
      throw new Rollback();
    });
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
  }
  return result as T;
}

/** One row in every tenant table for `orgId`, following the FK chain. */
async function seedTenant(orgId: string) {
  const [agent] = await owner<{ id: string }[]>`
    insert into agents (org_id, name, model) values (${orgId}, 'agent', 'm') returning id`;
  const [lead] = await owner<{ id: string }[]>`
    insert into leads (org_id, name, score) values (${orgId}, 'lead', 50) returning id`;
  const [conversation] = await owner<{ id: string }[]>`
    insert into conversations (org_id, agent_id, lead_id, channel)
    values (${orgId}, ${agent?.id ?? null}, ${lead?.id ?? null}, 'widget') returning id`;
  const [message] = await owner<{ id: string }[]>`
    insert into messages (org_id, conversation_id, role, content)
    values (${orgId}, ${conversation?.id ?? null}, 'user', 'hi') returning id`;
  await owner`
    insert into tool_calls (org_id, message_id, tool_name, input, status, latency_ms)
    values (${orgId}, ${message?.id ?? null}, 'search_inventory', '{}', 'success', 12)`;
  const [document] = await owner<{ id: string }[]>`
    insert into documents (org_id, title, source_type) values (${orgId}, 'doc', 'upload') returning id`;
  const embedding = `[${Array.from({ length: 1024 }, () => "0.01").join(",")}]`;
  await owner`
    insert into chunks (org_id, document_id, chunk_index, content, token_count, embedding)
    values (${orgId}, ${document?.id ?? null}, 0, 'chunk', 1, ${embedding}::vector)`;
  await owner`
    insert into inventory_items (org_id, kind, title) values (${orgId}, 'vehicle', 'car')`;
  await owner`insert into usage_events (org_id, type, quantity) values (${orgId}, 'ai_message', 1)`;
  await owner`
    insert into ai_traces (org_id, conversation_id, model, input_tokens, output_tokens, cost_usd, latency_ms, status)
    values (${orgId}, ${conversation?.id ?? null}, 'm', 10, 5, 0.0001, 300, 'success')`;
  return { conversationId: String(conversation?.id), documentId: String(document?.id) };
}

let seededA: Awaited<ReturnType<typeof seedTenant>>;

beforeAll(async () => {
  const orgs = await owner<{ id: string }[]>`
    insert into organizations (name, slug) values
      ('RLS A', ${`rls-a-${crypto.randomUUID()}`}), ('RLS B', ${`rls-b-${crypto.randomUUID()}`})
    returning id`;
  orgA = String(orgs[0]?.id);
  orgB = String(orgs[1]?.id);
  seededA = await seedTenant(orgA);
  await seedTenant(orgB);
});

afterAll(async () => {
  await owner`delete from organizations where id in (${orgA}, ${orgB})`;
  await Promise.all([owner.end(), app.end()]);
});

describe("catalog guards", () => {
  it("discovers the expected tenant tables", () => {
    expect(TENANT_TABLES.length).toBeGreaterThanOrEqual(10);
  });

  it("the runtime role cannot bypass RLS", async () => {
    const [role] = await owner`
      select rolsuper, rolbypassrls from pg_roles where rolname = 'closer_app'`;
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it("every table in public has RLS enabled", async () => {
    const rows = await owner<{ relname: string }[]>`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`;
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it("every tenant table has a tenant_isolation policy for closer_app on all commands", async () => {
    const rows = await owner<{ tablename: string }[]>`
      select tablename from pg_policies
      where schemaname = 'public' and policyname = 'tenant_isolation'
        and cmd = 'ALL' and roles = '{closer_app}'`;
    expect(rows.map((r) => r.tablename).sort()).toEqual([...TENANT_TABLES].sort());
  });
});

describe.each(TENANT_TABLES)("RLS on %s", (table) => {
  it("control: seed data exists for both orgs", async () => {
    const [counts] = await owner`
      select count(*) filter (where org_id = ${orgA})::int as a,
             count(*) filter (where org_id = ${orgB})::int as b
      from ${owner(table)}`;
    expect(counts?.a).toBeGreaterThan(0);
    expect(counts?.b).toBeGreaterThan(0);
  });

  it("without tenant context, no rows are visible", async () => {
    const rows = await asApp(null, (tx) => tx`select 1 from ${tx(table)}`);
    expect(rows.length).toBe(0);
  });

  it("with an empty tenant setting, no rows are visible", async () => {
    const rows = await asApp("", (tx) => tx`select 1 from ${tx(table)}`);
    expect(rows.length).toBe(0);
  });

  it("as org A, an unfiltered select returns only A's rows", async () => {
    const rows = await asApp(orgA, (tx) => tx`select org_id from ${tx(table)}`);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.org_id === orgA)).toBe(true);
  });

  it("as org A, explicitly asking for B's rows returns nothing", async () => {
    const rows = await asApp(orgA, (tx) => tx`select 1 from ${tx(table)} where org_id = ${orgB}`);
    expect(rows.length).toBe(0);
  });

  it("as org A, updating B's rows affects 0 rows", async () => {
    const result = await asApp(
      orgA,
      (tx) => tx`update ${tx(table)} set updated_at = now() where org_id = ${orgB}`,
    );
    expect(result.count).toBe(0);
  });

  it("as org A, deleting B's rows affects 0 rows", async () => {
    const result = await asApp(orgA, (tx) => tx`delete from ${tx(table)} where org_id = ${orgB}`);
    expect(result.count).toBe(0);
  });

  it("as org A, moving a row into org B is rejected by the policy's WITH CHECK", async () => {
    await expect(
      asApp(orgA, (tx) => tx`update ${tx(table)} set org_id = ${orgB} where org_id = ${orgA}`),
    ).rejects.toMatchObject({ code: "42501" });
  });
});

describe("composite foreign keys (id, org_id)", () => {
  // Enforced by Postgres even for the owner, i.e. even for code that bypasses RLS.
  it.each([
    [
      "a message in B pointing at A's conversation",
      () => owner`
        insert into messages (org_id, conversation_id, role, content)
        values (${orgB}, ${seededA.conversationId}, 'user', 'x')`,
    ],
    [
      "a trace in B pointing at A's conversation",
      () => owner`
        insert into ai_traces (org_id, conversation_id, model, input_tokens, output_tokens, cost_usd, latency_ms, status)
        values (${orgB}, ${seededA.conversationId}, 'm', 1, 1, 0, 1, 'success')`,
    ],
    [
      "a chunk in B pointing at A's document",
      () => owner`
        insert into chunks (org_id, document_id, chunk_index, content, token_count, embedding)
        values (${orgB}, ${seededA.documentId}, 99, 'x', 1,
                ${`[${Array.from({ length: 1024 }, () => "0").join(",")}]`}::vector)`,
    ],
  ])("reject %s", async (_name, insert) => {
    await expect(insert()).rejects.toMatchObject({ code: "23503" });
  });
});
