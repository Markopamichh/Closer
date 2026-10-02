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
