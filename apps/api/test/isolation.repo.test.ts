/**
 * Layer 1 in isolation: the tenant-scoped repository.
 *
 * Runs the repository on the OWNER connection, which bypasses RLS entirely. If these
 * pass, the repository filters by org_id on its own — RLS is a second net, not the only one.
 */
import type { Db } from "@closer/db";
import { createDb, createTenantRepo, sql, withTenant } from "@closer/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let db: Db;
let close: () => Promise<void>;
let orgA: string;
let orgB: string;
let agentB: string;
let conversationB: string;

beforeAll(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");
  ({ db, close } = createDb(url, { max: 2 }));

  // Sanity check: this connection really bypasses RLS, otherwise the test proves nothing.
  const [role] =
    await db.$client`select rolbypassrls or rolsuper as bypass from pg_roles where rolname = current_user`;
  expect(role?.bypass).toBe(true);

  const orgs = await db.$client`
    insert into organizations (name, slug) values
      ('Repo A', ${`repo-a-${crypto.randomUUID()}`}), ('Repo B', ${`repo-b-${crypto.randomUUID()}`})
    returning id`;
  orgA = String(orgs[0]?.id);
  orgB = String(orgs[1]?.id);
  const [agent] = await db.$client`
    insert into agents (org_id, name, model) values (${orgB}, 'B agent', 'm') returning id`;
  agentB = String(agent?.id);
  await db.$client`insert into agents (org_id, name, model) values (${orgA}, 'A agent', 'm')`;
  const [conversation] = await db.$client`
    insert into conversations (org_id, agent_id, channel) values (${orgB}, ${agentB}, 'dashboard_test')
    returning id`;
  conversationB = String(conversation?.id);
  await db.$client`
    insert into messages (org_id, conversation_id, role, content)
    values (${orgB}, ${conversationB}, 'user', 'B secret question')`;
});

afterAll(async () => {
  await close();
});

describe("tenant repository without RLS", () => {
  it("list returns only the scoped org's rows", async () => {
    const rows = await db.transaction((tx) => createTenantRepo(tx, orgA).agents.list());
    expect(rows.length).toBe(1);
    expect(rows.every((r) => r.orgId === orgA)).toBe(true);
  });

  it("get of another org's id returns null", async () => {
    const row = await db.transaction((tx) => createTenantRepo(tx, orgA).agents.get(agentB));
    expect(row).toBeNull();
  });

  it("update of another org's id affects nothing", async () => {
    const row = await db.transaction((tx) =>
      createTenantRepo(tx, orgA).agents.update(agentB, { name: "Pwned" }),
    );
    expect(row).toBeNull();
    const [after] = await db.$client`select name from agents where id = ${agentB}`;
    expect(after?.name).toBe("B agent");
  });

  it("delete of another org's id affects nothing", async () => {
    const deleted = await db.transaction((tx) => createTenantRepo(tx, orgA).agents.delete(agentB));
    expect(deleted).toBe(false);
    expect((await db.$client`select 1 from agents where id = ${agentB}`).length).toBe(1);
  });

  it("create always stamps the scoped org, whatever the input contains", async () => {
    const smuggled = { name: "Smuggled", model: "m", orgId: orgB } as {
      name: string;
      model: string;
    };
    const row = await db.transaction((tx) => createTenantRepo(tx, orgA).agents.create(smuggled));
    expect(row.orgId).toBe(orgA);
  });
});

describe("conversations repository without RLS", () => {
  const repoA = <T>(fn: (repo: ReturnType<typeof createTenantRepo>) => Promise<T>) =>
    db.transaction((tx) => fn(createTenantRepo(tx, orgA)));

  it("get of another org's conversation returns null", async () => {
    expect(await repoA((r) => r.conversations.get(conversationB))).toBeNull();
  });

  it("never returns another org's messages, even by conversation id", async () => {
    expect(await repoA((r) => r.conversations.recentMessages(conversationB, 50))).toEqual([]);
  });

  it("cannot append a message to another org's conversation", async () => {
    await expect(
      repoA((r) =>
        r.conversations.addMessage({ conversationId: conversationB, role: "user", content: "x" }),
      ),
    ).rejects.toThrow();
    const rows =
      await db.$client`select content from messages where conversation_id = ${conversationB}`;
    expect(rows.map((m) => m.content)).toEqual(["B secret question"]);
  });
});

describe("withTenant", () => {
  it("rejects a non-UUID org id before touching the database", async () => {
    await expect(withTenant(db, "' or 1=1 --", async () => Promise.resolve())).rejects.toThrow(
      "orgId must be a UUID",
    );
  });

  it("sets app.org_id only for the duration of the transaction", async () => {
    // A single-connection pool guarantees the follow-up query reuses the same connection,
    // which is exactly where a session-level setting would leak to the next request.
    const single = createDb(process.env.DATABASE_URL ?? "", { max: 1 });
    try {
      const inside = await withTenant(single.db, orgA, async (_repo, tx) => {
        const [row] = await tx.execute<{ org: string }>(
          sql`select current_setting('app.org_id', true) as org`,
        );
        return row?.org;
      });
      expect(inside).toBe(orgA);

      const [outside] = await single.db.execute<{ org: string | null }>(
        sql`select current_setting('app.org_id', true) as org`,
      );
      expect(outside?.org ?? "").toBe("");
    } finally {
      await single.close();
    }
  });
});
