import type { AgentTool } from "@closer/ai";
import type { LeadDto, LeadPage, MemberDto } from "@closer/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAgentTools, saidByCustomer } from "../src/agent/tools";
import type { World } from "./fixtures";
import { buildWorld } from "./fixtures";
import type { TestContext } from "./helpers";
import { createTestContext, json } from "./helpers";

let ctx: TestContext;
let w: World;
const leadsPath = () => `/api/organizations/${w.orgA}/leads`;

/** A widget conversation in `orgId` where the customer said `said`. */
async function conversation(orgId: string, agentId: string, said: string[]) {
  const [row] = await ctx.sql<{ id: string }[]>`
    insert into conversations (org_id, agent_id, channel, visitor_id)
    values (${orgId}, ${agentId}, 'widget', ${crypto.randomUUID()}) returning id`;
  const id = String(row?.id);
  for (const content of said) {
    await ctx.sql`insert into messages (org_id, conversation_id, role, content)
      values (${orgId}, ${id}, 'user', ${content})`;
  }
  return id;
}

function saveLead(conversationId: string, orgId = w.orgA) {
  const tools = createAgentTools({ db: ctx.db, orgId, conversationId, embedder: ctx.embedder });
  const tool = tools.find((t): t is AgentTool => t.name === "save_lead");
  if (!tool) throw new Error("save_lead missing");
  return async (args: unknown) => (await tool.execute(tool.input.parse(args))) as object;
}

const leadOf = async (conversationId: string) =>
  ctx.sql`select l.* from leads l join conversations c on c.lead_id = l.id
    where c.id = ${conversationId}`;

beforeAll(async () => {
  ctx = createTestContext();
  w = await buildWorld(ctx);
});

afterAll(async () => {
  await ctx.close();
});

describe("saidByCustomer", () => {
  it("matches emails case-insensitively and phones by their digits", () => {
    const said = ["I'm Ana, ana.perez@Mail.com", "call me at +54 9 11 1234-5678"];
    expect(saidByCustomer(said, { email: "ANA.PEREZ@mail.com" })).toBe(true);
    expect(saidByCustomer(said, { phone: "5491112345678" })).toBe(true);
    expect(saidByCustomer(said, { email: "ana@mail.com" })).toBe(false);
    expect(saidByCustomer(said, { phone: "1199998888" })).toBe(false);
    expect(saidByCustomer(said, {})).toBe(true);
  });
});

describe("save_lead tool", () => {
  it("creates the conversation's lead, then updates the same lead", async () => {
    const id = await conversation(w.orgA, w.agentA.id, [
      "Hi, I want a pickup",
      "I'm Ana, ana@example.com",
    ]);
    const save = saveLead(id);

    expect(await save({ interest: "pickup", score: 40 })).toEqual({ saved: true });
    expect(await save({ name: "Ana", email: "ana@example.com", score: 70 })).toEqual({
      saved: true,
    });

    const leads = await leadOf(id);
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({
      org_id: w.orgA,
      name: "Ana",
      email: "ana@example.com",
      score: 70,
      status: "new",
      metadata: { interest: "pickup" },
    });
  });

  it("two saves in the same round (run in parallel) still make one lead", async () => {
    const id = await conversation(w.orgA, w.agentA.id, ["I'm Leo, leo@example.com"]);
    const save = saveLead(id);
    await Promise.all([save({ name: "Leo" }), save({ email: "leo@example.com" })]);
    const [row] = await ctx.sql`select count(*)::int as n from leads
      where org_id = ${w.orgA} and (name = 'Leo' or email = 'leo@example.com')`;
    expect(row?.n).toBe(1);
  });

  it("refuses contact details the customer never wrote, and saves nothing", async () => {
    const id = await conversation(w.orgA, w.agentA.id, ["Just browsing"]);
    const result = await saveLead(id)({ email: "invented@example.com" });
    expect(result).toHaveProperty("error");
    expect(await leadOf(id)).toHaveLength(0);
  });

  it("an id the model cannot send: tools bound to org A never touch B's conversation", async () => {
    const id = await conversation(w.orgB, w.agentB.id, ["I like trucks"]);
    const result = await saveLead(id, w.orgA)({ interest: "trucks" });
    expect(result).toEqual({ error: "Could not save the lead" });
    expect(await leadOf(id)).toHaveLength(0);
  });

  it("rejects an empty save (schema)", () => {
    const tools = createAgentTools({
      db: ctx.db,
      orgId: w.orgA,
      conversationId: crypto.randomUUID(),
      embedder: ctx.embedder,
    });
    const tool = tools.find((t) => t.name === "save_lead");
    expect(tool?.input.safeParse({}).success).toBe(false);
  });
});

describe("leads API", () => {
  let leadId: string;

  beforeAll(async () => {
    const id = await conversation(w.orgA, w.agentA.id, ["Mia here, mia@example.com"]);
    await saveLead(id)({ name: "Mia", email: "mia@example.com", interest: "SUV", score: 85 });
    const [row] = await leadOf(id);
    leadId = String(row?.id);
  });

  it("lists leads with interest and their latest conversation, for every role", async () => {
    for (const role of ["owner", "agent", "viewer"] as const) {
      const res = await w.a[role].request(leadsPath());
      expect(res.status).toBe(200);
      const page = await json<LeadPage>(res);
      const mia = page.leads.find((l) => l.id === leadId);
      expect(mia).toMatchObject({ name: "Mia", interest: "SUV", score: 85, status: "new" });
      expect(mia?.conversationId).toEqual(expect.any(String));
    }
  });

  it("filters by status", async () => {
    const page = await json<LeadPage>(await w.a.owner.request(`${leadsPath()}?status=won`));
    expect(page.leads.map((l) => l.id)).not.toContain(leadId);
    expect((await w.a.owner.request(`${leadsPath()}?status=hot`)).status).toBe(422);
  });

  it("the team moves a lead and assigns it to a teammate", async () => {
    const res = await w.a.agent.request(`${leadsPath()}/${leadId}`, {
      method: "PATCH",
      body: { status: "contacted", assignedTo: w.a.agent.userId },
    });
    expect(res.status).toBe(200);
    const { lead } = await json<{ lead: LeadDto }>(res);
    expect(lead.status).toBe("contacted");
    expect(lead.assignee).toEqual({ id: w.a.agent.userId, name: "agent-a" });

    const cleared = await w.a.owner.request(`${leadsPath()}/${leadId}`, {
      method: "PATCH",
      body: { assignedTo: null },
    });
    expect((await json<{ lead: LeadDto }>(cleared)).lead.assignee).toBeNull();
  });

  it("cannot assign to someone outside the org (422)", async () => {
    for (const outsider of [w.ownerB.userId, w.outsider.userId]) {
      const res = await w.a.owner.request(`${leadsPath()}/${leadId}`, {
        method: "PATCH",
        body: { assignedTo: outsider },
      });
      expect(res.status).toBe(422);
    }
  });

  it("viewers cannot change leads (403), and contact details are not editable (422)", async () => {
    const asViewer = await w.a.viewer.request(`${leadsPath()}/${leadId}`, {
      method: "PATCH",
      body: { status: "won" },
    });
    expect(asViewer.status).toBe(403);
    const asOwner = await w.a.owner.request(`${leadsPath()}/${leadId}`, {
      method: "PATCH",
      body: { email: "other@example.com" },
    });
    expect(asOwner.status).toBe(422);
  });

  it("lists the org's members for assignment", async () => {
    const res = await w.a.viewer.request(`/api/organizations/${w.orgA}/members`);
    expect(res.status).toBe(200);
    const { members } = await json<{ members: MemberDto[] }>(res);
    expect(members.map((m) => m.id).sort()).toEqual(
      [w.a.owner.userId, w.a.agent.userId, w.a.viewer.userId].sort(),
    );
  });
});
