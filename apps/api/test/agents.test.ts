import { agentSchema } from "@closer/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { World } from "./fixtures";
import { buildWorld } from "./fixtures";
import type { TestContext } from "./helpers";
import { createTestContext, json } from "./helpers";

let ctx: TestContext;
let w: World;
const base = () => `/api/organizations/${w.orgA}/agents`;

beforeAll(async () => {
  ctx = createTestContext();
  w = await buildWorld(ctx);
});

afterAll(async () => {
  await ctx.close();
});

describe("agent model", () => {
  it("defaults to gpt-5-nano when omitted", async () => {
    const res = await w.a.owner.request(base(), {
      method: "POST",
      body: { name: "Default model" },
    });
    expect(res.status).toBe(201);
    expect((await json<{ agent: { model: string } }>(res)).agent.model).toBe("gpt-5-nano");
  });

  it.each([
    ["create", "POST", () => base(), { name: "Bad", model: "claude-sonnet-5" }],
    ["update", "PATCH", () => `${base()}/${w.agentA.id}`, { model: "gpt-unknown" }],
  ])("rejects a model outside the allowed list on %s (422)", async (_label, method, path, body) => {
    expect((await w.a.owner.request(path(), { method, body })).status).toBe(422);
  });
});

describe("response shape", () => {
  it("every endpoint returns the public agent shape, never org_id", async () => {
    const created = await w.a.owner.request(base(), { method: "POST", body: { name: "Shape" } });
    const { agent } = await json<{ agent: { id: string } }>(created);
    const path = `${base()}/${agent.id}`;
    const bodies = [
      agent,
      (await json<{ agent: unknown }>(await w.a.owner.request(path))).agent,
      (
        await json<{ agent: unknown }>(
          await w.a.owner.request(path, { method: "PATCH", body: { name: "Shape 2" } }),
        )
      ).agent,
      ...(await json<{ agents: unknown[] }>(await w.a.owner.request(base()))).agents,
    ];
    for (const body of bodies) {
      expect(body).not.toHaveProperty("orgId");
      expect(agentSchema.strict().safeParse(body).success).toBe(true);
    }
  });
});
