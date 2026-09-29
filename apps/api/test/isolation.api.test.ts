/**
 * Tenant isolation, end to end through the HTTP API.
 *
 * Threat model: an authenticated user of org A (any role) — or a signed-in user with no
 * org at all — tries to read or modify org B's data. Every attempt must fail with the
 * same response as for an org that does not exist, and org B's rows must be unchanged.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { World } from "./fixtures";
import { buildWorld } from "./fixtures";
import type { Client, TestContext } from "./helpers";
import { anonymous, createTestContext, json, signUp, uniqueEmail } from "./helpers";

type ErrorBody = { error: { code: string; message: string; requestId: string } };

let ctx: TestContext;
let w: World;

beforeAll(async () => {
  ctx = createTestContext();
  w = await buildWorld(ctx);
});

afterAll(async () => {
  await ctx.close();
});

/** Ground truth for org B, read with the owner connection (bypasses RLS). */
async function snapshotOrgB() {
  const agents = await ctx.sql`
    select id, name, tone, is_active, updated_at from agents where org_id = ${w.orgB} order by id`;
  const [counts] = await ctx.sql`
    select
      (select count(*) from invitations where org_id = ${w.orgB})::int as invitations,
      (select count(*) from memberships where org_id = ${w.orgB})::int as memberships`;
  return { agents, counts };
}

type Attack = {
  name: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: () => string;
  body?: () => unknown;
};

const attacksOnOrgB: Attack[] = [
  { name: "list B's agents", method: "GET", path: () => `/api/organizations/${w.orgB}/agents` },
  {
    name: "read B's agent",
    method: "GET",
    path: () => `/api/organizations/${w.orgB}/agents/${w.agentB.id}`,
  },
  {
    name: "create an agent in B",
    method: "POST",
    path: () => `/api/organizations/${w.orgB}/agents`,
    body: () => ({ name: "Injected", model: "claude-sonnet-5" }),
  },
  {
    name: "update B's agent",
    method: "PATCH",
    path: () => `/api/organizations/${w.orgB}/agents/${w.agentB.id}`,
    body: () => ({ name: "Pwned", isActive: false }),
  },
  {
    name: "delete B's agent",
    method: "DELETE",
    path: () => `/api/organizations/${w.orgB}/agents/${w.agentB.id}`,
  },
  {
    name: "invite someone into B",
    method: "POST",
    path: () => `/api/organizations/${w.orgB}/invitations`,
    body: () => ({ email: uniqueEmail("intruder"), role: "agent" }),
  },
];

const attackers: [string, () => Client][] = [
  ["owner of A", () => w.a.owner],
  ["agent of A", () => w.a.agent],
  ["viewer of A", () => w.a.viewer],
  ["user with no organization", () => w.outsider],
];

const send = (client: Client, attack: Attack) =>
  client.request(attack.path(), {
    method: attack.method,
    ...(attack.body ? { body: attack.body() } : {}),
  });

describe("control: each tenant can use its own data", () => {
  // Without these, every 404 below could simply mean "the route is broken".
  it("owner of A reads A's agent", async () => {
    const res = await w.a.owner.request(`/api/organizations/${w.orgA}/agents/${w.agentA.id}`);
    expect(res.status).toBe(200);
  });

  it("owner of B reads B's agent", async () => {
    const res = await w.ownerB.request(`/api/organizations/${w.orgB}/agents/${w.agentB.id}`);
    expect(res.status).toBe(200);
  });
});

describe("cross-tenant requests to org B's routes", () => {
  describe.each(attackers)("as %s", (_label, attacker) => {
    it.each(attacksOnOrgB)("cannot $name (404, B unchanged)", async (attack) => {
      const before = await snapshotOrgB();

      const res = await send(attacker(), attack);

      expect(res.status).toBe(404);
      expect((await json<ErrorBody>(res)).error.code).toBe("not_found");
      expect(await snapshotOrgB()).toEqual(before);
    });
  });
});

describe("B's resource ids through A's routes (IDOR)", () => {
  const idor: Attack[] = [
    {
      name: "read",
      method: "GET",
      path: () => `/api/organizations/${w.orgA}/agents/${w.agentB.id}`,
    },
    {
      name: "update",
      method: "PATCH",
      path: () => `/api/organizations/${w.orgA}/agents/${w.agentB.id}`,
      body: () => ({ name: "Pwned" }),
    },
    {
      name: "delete",
      method: "DELETE",
      path: () => `/api/organizations/${w.orgA}/agents/${w.agentB.id}`,
    },
  ];

  it.each(idor)(
    "owner of A cannot $name B's agent via A's org (404, B unchanged)",
    async (attack) => {
      const before = await snapshotOrgB();

      const res = await send(w.a.owner, attack);

      expect(res.status).toBe(404);
      expect((await json<ErrorBody>(res)).error.message).toBe("Agent not found");
      expect(await snapshotOrgB()).toEqual(before);
    },
  );
});

describe("responses do not reveal whether another org exists", () => {
  it("org B and a random org id produce identical 404s", async () => {
    const randomOrg = crypto.randomUUID();
    const [forB, forRandom] = await Promise.all([
      w.a.owner.request(`/api/organizations/${w.orgB}/agents`),
      w.a.owner.request(`/api/organizations/${randomOrg}/agents`),
    ]);

    expect(forB.status).toBe(forRandom.status);
    const strip = ({ error: { requestId: _requestId, ...rest } }: ErrorBody) => rest;
    expect(strip(await json<ErrorBody>(forB))).toEqual(strip(await json<ErrorBody>(forRandom)));
  });

  it("a malformed org id is also a plain 404", async () => {
    const res = await w.a.owner.request("/api/organizations/not-a-uuid/agents");
    expect(res.status).toBe(404);
  });
});

describe("org_id is never taken from the request body", () => {
  it("creating an agent with orgId=B in the body still creates it in A", async () => {
    const before = await snapshotOrgB();

    const res = await w.a.owner.request(`/api/organizations/${w.orgA}/agents`, {
      method: "POST",
      body: { name: "Smuggled", model: "claude-sonnet-5", orgId: w.orgB },
    });

    expect(res.status).toBe(201);
    const { agent } = await json<{ agent: { id: string } }>(res);
    const [row] = await ctx.sql`select org_id from agents where id = ${agent.id}`;
    expect(row?.org_id).toBe(w.orgA);
    expect(await snapshotOrgB()).toEqual(before);
  });

  it("updating an agent's orgId is rejected outright (422)", async () => {
    const res = await w.a.owner.request(`/api/organizations/${w.orgA}/agents/${w.agentA.id}`, {
      method: "PATCH",
      body: { orgId: w.orgB },
    });

    expect(res.status).toBe(422);
    const [row] = await ctx.sql`select org_id from agents where id = ${w.agentA.id}`;
    expect(row?.org_id).toBe(w.orgA);
  });
});

describe("listings only contain the caller's tenants", () => {
  it("GET /api/organizations lists A for A's members and nothing for outsiders", async () => {
    for (const client of Object.values(w.a)) {
      const { organizations } = await json<{ organizations: { id: string }[] }>(
        await client.request("/api/organizations"),
      );
      expect(organizations.map((o) => o.id)).toEqual([w.orgA]);
    }
    const { organizations } = await json<{ organizations: unknown[] }>(
      await w.outsider.request("/api/organizations"),
    );
    expect(organizations).toEqual([]);
  });

  it("A's agent list never includes B's agents", async () => {
    const { agents } = await json<{ agents: { id: string; orgId: string }[] }>(
      await w.a.owner.request(`/api/organizations/${w.orgA}/agents`),
    );
    expect(agents.length).toBeGreaterThan(0);
    expect(agents.every((a) => a.orgId === w.orgA)).toBe(true);
    expect(agents.map((a) => a.id)).not.toContain(w.agentB.id);
  });
});

describe("authentication is required on every tenant route", () => {
  const routes: Attack[] = [
    { name: "GET /api/me", method: "GET", path: () => "/api/me" },
    { name: "GET /api/organizations", method: "GET", path: () => "/api/organizations" },
    {
      name: "POST /api/organizations",
      method: "POST",
      path: () => "/api/organizations",
      body: () => ({ name: "Anon Org" }),
    },
    ...attacksOnOrgB.map((a) => ({ ...a, name: `${a.method} ${a.name}` })),
  ];

  it.each(routes)("$name → 401", async (route) => {
    const res = await anonymous(ctx.app, route.path(), route.method, route.body?.());
    expect(res.status).toBe(401);
  });
});

describe("roles within a tenant", () => {
  const agentsPath = () => `/api/organizations/${w.orgA}/agents`;

  async function disposableAgent(): Promise<string> {
    const res = await w.a.owner.request(agentsPath(), {
      method: "POST",
      body: { name: "Disposable", model: "claude-sonnet-5" },
    });
    return (await json<{ agent: { id: string } }>(res)).agent.id;
  }

  it.each([
    ["owner", 200],
    ["agent", 200],
    ["viewer", 200],
  ] as const)("%s can read agents (%i)", async (role, status) => {
    expect((await w.a[role].request(agentsPath())).status).toBe(status);
  });

  it.each([
    ["owner", 201],
    ["agent", 403],
    ["viewer", 403],
  ] as const)("%s creating an agent → %i", async (role, status) => {
    const res = await w.a[role].request(agentsPath(), {
      method: "POST",
      body: { name: `By ${role}`, model: "claude-sonnet-5" },
    });
    expect(res.status).toBe(status);
  });

  it.each([
    ["owner", 200],
    ["agent", 403],
    ["viewer", 403],
  ] as const)("%s updating an agent → %i", async (role, status) => {
    const res = await w.a[role].request(`${agentsPath()}/${w.agentA.id}`, {
      method: "PATCH",
      body: { tone: "professional" },
    });
    expect(res.status).toBe(status);
  });

  it.each([
    ["owner", 204],
    ["agent", 403],
    ["viewer", 403],
  ] as const)("%s deleting an agent → %i", async (role, status) => {
    const id = await disposableAgent();
    const res = await w.a[role].request(`${agentsPath()}/${id}`, { method: "DELETE" });
    expect(res.status).toBe(status);
    const rows = await ctx.sql`select 1 from agents where id = ${id}`;
    expect(rows.length).toBe(status === 204 ? 0 : 1);
  });

  it.each([
    ["owner", 201],
    ["agent", 403],
    ["viewer", 403],
  ] as const)("%s inviting a member → %i", async (role, status) => {
    const res = await w.a[role].request(`/api/organizations/${w.orgA}/invitations`, {
      method: "POST",
      body: { email: uniqueEmail("invitee"), role: "viewer" },
    });
    expect(res.status).toBe(status);
  });

  it("nobody can be invited as owner (422)", async () => {
    const res = await w.a.owner.request(`/api/organizations/${w.orgA}/invitations`, {
      method: "POST",
      body: { email: uniqueEmail("wannabe-owner"), role: "owner" },
    });
    expect(res.status).toBe(422);
  });

  it("non-owners are also blocked on Better Auth's own invite endpoint", async () => {
    const res = await w.a.viewer.request("/api/auth/organization/invite-member", {
      method: "POST",
      body: { email: uniqueEmail("sneaky"), role: "agent", organizationId: w.orgA },
    });
    expect(res.status).toBe(403);
  });
});

describe("joining a tenant requires an invitation for a verified email", () => {
  async function invite(email: string) {
    const res = await w.a.owner.request(`/api/organizations/${w.orgA}/invitations`, {
      method: "POST",
      body: { email, role: "agent" },
    });
    return (await json<{ id: string }>(res)).id;
  }

  const accept = (client: Client, invitationId: string) =>
    client.request("/api/auth/organization/accept-invitation", {
      method: "POST",
      body: { invitationId },
    });

  it("an unverified account cannot accept, a verified one can, and gains access to A only", async () => {
    const newcomer = await signUp(ctx.app, "newcomer");
    const invitationId = await invite(newcomer.email);

    // Someone could have registered this address without owning the mailbox.
    expect((await accept(newcomer, invitationId)).status).toBe(403);
    expect((await newcomer.request(`/api/organizations/${w.orgA}/agents`)).status).toBe(404);

    await ctx.sql`update users set email_verified = true where id = ${newcomer.userId}`;
    expect((await accept(newcomer, invitationId)).status).toBe(200);

    expect((await newcomer.request(`/api/organizations/${w.orgA}/agents`)).status).toBe(200);
    expect((await newcomer.request(`/api/organizations/${w.orgB}/agents`)).status).toBe(404);
  });

  it("an invitation cannot be accepted by a different (verified) user", async () => {
    const invitationId = await invite(uniqueEmail("intended"));
    const other = await signUp(ctx.app, "other");
    await ctx.sql`update users set email_verified = true where id = ${other.userId}`;

    const res = await accept(other, invitationId);

    expect(res.status).toBeGreaterThanOrEqual(400);
    const rows = await ctx.sql`
      select 1 from memberships where org_id = ${w.orgA} and user_id = ${other.userId}`;
    expect(rows.length).toBe(0);
  });
});
