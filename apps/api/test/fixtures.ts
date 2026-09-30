import type { OrgRole } from "@closer/shared";
import type { Client, TestContext } from "./helpers";
import { json, signUp } from "./helpers";

export function fileForm(
  name: string,
  content: string | Uint8Array,
  type = "text/plain",
): FormData {
  const form = new FormData();
  const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content);
  form.append("file", new File([bytes], name, { type }));
  return form;
}

type Agent = { id: string; orgId: string; name: string };
type Item = { id: string; orgId: string; externalId: string | null };
type Doc = { id: string; title: string; status: string };

export type World = {
  orgA: string;
  orgB: string;
  /** Owner / agent / viewer of org A. */
  a: Record<OrgRole, Client>;
  /** Owner of org B. */
  ownerB: Client;
  /** Signed in, member of nothing. */
  outsider: Client;
  agentA: Agent;
  agentB: Agent;
  itemA: Item;
  itemB: Item;
  docA: Doc;
  docB: Doc;
};

async function createOrg(client: Client, name: string): Promise<string> {
  const res = await client.request("/api/organizations", { method: "POST", body: { name } });
  if (res.status !== 201) throw new Error(`create org failed: ${res.status}`);
  return (await json<{ id: string }>(res)).id;
}

async function createAgent(client: Client, orgId: string, name: string): Promise<Agent> {
  const res = await client.request(`/api/organizations/${orgId}/agents`, {
    method: "POST",
    body: { name, model: "claude-sonnet-5" },
  });
  if (res.status !== 201) throw new Error(`create agent failed: ${res.status}`);
  return (await json<{ agent: Agent }>(res)).agent;
}

async function createItem(client: Client, orgId: string, externalId: string): Promise<Item> {
  const res = await client.request(`/api/organizations/${orgId}/inventory`, {
    method: "POST",
    body: {
      kind: "vehicle",
      externalId,
      title: "Toyota Corolla 2021",
      priceCents: 1_850_000,
      attributes: { make: "Toyota", model: "Corolla", year: 2021 },
    },
  });
  if (res.status !== 201) throw new Error(`create item failed: ${res.status}`);
  return (await json<{ item: Item }>(res)).item;
}

async function createDocument(client: Client, orgId: string, name: string, text: string) {
  const res = await client.upload(`/api/organizations/${orgId}/documents`, fileForm(name, text));
  if (res.status !== 201) throw new Error(`upload failed: ${res.status}`);
  return (await json<{ document: Doc }>(res)).document;
}

/**
 * Two tenants built through the public API. Extra memberships are inserted directly:
 * the invitation flow has its own test, and this keeps the isolation tests focused.
 */
export async function buildWorld({ app, sql }: TestContext): Promise<World> {
  const [ownerA, agent, viewer, ownerB, outsider] = await Promise.all([
    signUp(app, "owner-a"),
    signUp(app, "agent-a"),
    signUp(app, "viewer-a"),
    signUp(app, "owner-b"),
    signUp(app, "outsider"),
  ]);

  const [orgA, orgB] = await Promise.all([
    createOrg(ownerA, "Acme Motors"),
    createOrg(ownerB, "Beta Realty"),
  ]);

  await sql`
    insert into memberships (org_id, user_id, role) values
      (${orgA}, ${agent.userId}, 'agent'),
      (${orgA}, ${viewer.userId}, 'viewer')
  `;

  const [agentA, agentB] = await Promise.all([
    createAgent(ownerA, orgA, "Acme sales agent"),
    createAgent(ownerB, orgB, "Beta sales agent"),
  ]);

  // Same external id in both orgs on purpose: uniqueness is per tenant.
  const [itemA, itemB] = await Promise.all([
    createItem(ownerA, orgA, "VIN-SHARED-001"),
    createItem(ownerB, orgB, "VIN-SHARED-001"),
  ]);

  const [docA, docB] = await Promise.all([
    createDocument(ownerA, orgA, "financing.md", "# Financing\n\nAcme offers 60 month plans."),
    createDocument(ownerB, orgB, "rentals.md", "# Rentals\n\nBeta requires two guarantors."),
  ]);

  return {
    orgA,
    orgB,
    a: { owner: ownerA, agent, viewer },
    ownerB,
    outsider,
    agentA,
    agentB,
    itemA,
    itemB,
    docA,
    docB,
  };
}
