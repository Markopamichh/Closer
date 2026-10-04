import type { AgentDto, WidgetConfig } from "@closer/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { World } from "./fixtures";
import { buildWorld } from "./fixtures";
import type { TestContext } from "./helpers";
import { anonymous, createTestContext, json } from "./helpers";

let ctx: TestContext;
let w: World;
const agentPath = () => `/api/organizations/${w.orgA}/agents/${w.agentA.id}`;

const patch = (body: unknown, client = () => w.a.owner) =>
  client().request(agentPath(), { method: "PATCH", body });

beforeAll(async () => {
  ctx = createTestContext();
  w = await buildWorld(ctx);
});

afterAll(async () => {
  await ctx.close();
});

describe("widget settings on the agent", () => {
  it("are part of the agent DTO, with a public key and safe defaults", async () => {
    const { agent } = await json<{ agent: AgentDto }>(await w.a.owner.request(agentPath()));
    expect(agent).toMatchObject({ widgetEnabled: false, allowedOrigins: [], timezone: "UTC" });
    expect(agent.publicKey).toMatch(/^pk_[0-9a-f]{32}$/);
  });

  it("owners save origins normalized and deduplicated, and a time zone", async () => {
    const res = await patch({
      widgetEnabled: true,
      timezone: "America/Argentina/Buenos_Aires",
      allowedOrigins: [
        "https://Shop.example.com/",
        "https://shop.example.com",
        "http://localhost:8080",
      ],
    });
    expect(res.status).toBe(200);
    const { agent } = await json<{ agent: AgentDto }>(res);
    expect(agent.allowedOrigins).toEqual(["https://shop.example.com", "http://localhost:8080"]);
    expect(agent.timezone).toBe("America/Argentina/Buenos_Aires");
    expect(agent.widgetEnabled).toBe(true);
  });

  it.each([
    ["a path", "https://shop.example.com/cars"],
    ["a query", "https://shop.example.com/?a=1"],
    ["credentials", "https://user@shop.example.com"],
    ["another scheme", "javascript:alert(1)"],
    ["a wildcard", "https://*.example.com"],
    ["CSP syntax", "https://a.com 'unsafe-inline'"],
    ["not a URL", "shop.example.com"],
  ])("rejects an origin with %s (422)", async (_label, origin) => {
    expect((await patch({ allowedOrigins: [origin] })).status).toBe(422);
  });

  it("rejects more than 10 origins and unknown time zones (422)", async () => {
    const many = Array.from({ length: 11 }, (_, i) => `https://s${i}.example.com`);
    expect((await patch({ allowedOrigins: many })).status).toBe(422);
    expect((await patch({ timezone: "Mars/Olympus" })).status).toBe(422);
  });

  it.each(["agent", "viewer"] as const)("a %s cannot change them (403)", async (role) => {
    expect((await patch({ widgetEnabled: false }, () => w.a[role])).status).toBe(403);
  });
});

describe("public widget config and key rotation", () => {
  const configOf = (key: string) => anonymous(ctx.app, `/api/public/widget/${key}`);

  it("serves the embed page what it needs, without a session", async () => {
    await patch({ widgetEnabled: true, allowedOrigins: ["https://shop.example.com"] });
    const { agent } = await json<{ agent: AgentDto }>(await w.a.owner.request(agentPath()));

    const res = await configOf(agent.publicKey);
    expect(res.status).toBe(200);
    expect(await json<WidgetConfig>(res)).toEqual({
      agentName: w.agentA.name,
      businessName: expect.any(String) as unknown,
      allowedOrigins: ["https://shop.example.com"],
    });
  });

  it("rotating the key retires the old one", async () => {
    const before = await json<{ agent: AgentDto }>(await w.a.owner.request(agentPath()));
    const res = await w.a.owner.request(`${agentPath()}/widget/rotate-key`, { method: "POST" });
    expect(res.status).toBe(200);
    const after = await json<{ agent: AgentDto }>(res);

    expect(after.agent.publicKey).not.toBe(before.agent.publicKey);
    expect((await configOf(before.agent.publicKey)).status).toBe(404);
    expect((await configOf(after.agent.publicKey)).status).toBe(200);
  });

  it.each(["agent", "viewer"] as const)("a %s cannot rotate it (403)", async (role) => {
    const res = await w.a[role].request(`${agentPath()}/widget/rotate-key`, { method: "POST" });
    expect(res.status).toBe(403);
  });

  it("a disabled widget has no public config (404)", async () => {
    await patch({ widgetEnabled: false });
    const { agent } = await json<{ agent: AgentDto }>(await w.a.owner.request(agentPath()));
    expect((await configOf(agent.publicKey)).status).toBe(404);
  });
});
