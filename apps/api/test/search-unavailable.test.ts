import type { EmbeddingProvider } from "@closer/ai";
import { EmbeddingError } from "@closer/ai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client, TestContext } from "./helpers";
import { createTestContext, json, signUp } from "./helpers";

/** Behaves like Voyage would: the status of the next call is set by each test. */
let nextStatus = 429;
const failingEmbedder: EmbeddingProvider = {
  model: "voyage-4",
  embed: () =>
    Promise.reject(
      new EmbeddingError(`Voyage request failed with status ${nextStatus}`, nextStatus),
    ),
};

let ctx: TestContext;
let owner: Client;
let orgId: string;

beforeAll(async () => {
  ctx = createTestContext({ embedder: failingEmbedder });
  owner = await signUp(ctx.app, "search-unavailable");
  const res = await owner.request("/api/organizations", {
    method: "POST",
    body: { name: "Rate Limited" },
  });
  orgId = (await json<{ id: string }>(res)).id;
});

afterAll(async () => {
  await ctx.close();
});

const search = () => owner.request(`/api/organizations/${orgId}/documents/search?q=opening+hours`);

describe("search when the embedding provider fails", () => {
  it.each([429, 503])("a provider %i is a 503 the UI can explain, not a 500", async (status) => {
    nextStatus = status;
    const res = await search();
    expect(res.status).toBe(503);
    expect((await json<{ error: { code: string } }>(res)).error.code).toBe("service_unavailable");
  });

  it("a rejected API key stays a 500: it is our misconfiguration, not a transient outage", async () => {
    nextStatus = 401;
    expect((await search()).status).toBe(500);
  });

  it("records no usage when the query could not be embedded", async () => {
    nextStatus = 429;
    await search();
    const rows = await ctx.sql`select 1 from usage_events where org_id = ${orgId}`;
    expect(rows).toHaveLength(0);
  });
});
