import type { EmbeddingProvider } from "@closer/ai";
import { createFakeEmbedder } from "@closer/ai";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRedisRateLimiter } from "../src/lib/rate-limit";
import type { Client, TestContext } from "./helpers";
import { createTestContext, json, signUp } from "./helpers";

const fake = createFakeEmbedder();
let embedCalls = 0;
const countingEmbedder: EmbeddingProvider = {
  model: fake.model,
  embed: (texts, inputType) => {
    embedCalls++;
    return fake.embed(texts, inputType);
  },
};

const redis = new Redis(process.env.REDIS_URL ?? "");
let ctx: TestContext;
let ownerA: Client;
let ownerB: Client;
let orgA: string;
let orgB: string;

async function newOrg(client: Client, name: string) {
  const res = await client.request("/api/organizations", { method: "POST", body: { name } });
  return (await json<{ id: string }>(res)).id;
}
const search = (client: Client, orgId: string) =>
  client.request(`/api/organizations/${orgId}/documents/search?q=opening+hours`);

beforeAll(async () => {
  ctx = createTestContext({
    embedder: countingEmbedder,
    searchLimiter: createRedisRateLimiter(redis, {
      prefix: `test:${crypto.randomUUID()}`,
      limit: 2,
      windowSeconds: 60,
    }),
  });
  [ownerA, ownerB] = await Promise.all([signUp(ctx.app, "limit-a"), signUp(ctx.app, "limit-b")]);
  [orgA, orgB] = await Promise.all([newOrg(ownerA, "Limit A"), newOrg(ownerB, "Limit B")]);
});

afterAll(async () => {
  await Promise.all([ctx.close(), redis.quit()]);
});

describe("search rate limit", () => {
  it("allows the limit, then answers 429 with Retry-After and costs nothing", async () => {
    expect((await search(ownerA, orgA)).status).toBe(200);
    expect((await search(ownerA, orgA)).status).toBe(200);
    const callsBefore = embedCalls;

    const res = await search(ownerA, orgA);

    expect(res.status).toBe(429);
    expect((await json<{ error: { code: string } }>(res)).error.code).toBe("rate_limited");
    const retryAfter = Number(res.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect(embedCalls).toBe(callsBefore);
    const usage = await ctx.sql`select 1 from usage_events where org_id = ${orgA}`;
    expect(usage).toHaveLength(2);
  });

  it("is counted per organization", async () => {
    expect((await search(ownerB, orgB)).status).toBe(200);
  });
});

describe("when the limiter itself fails", () => {
  it("fails open: search keeps working", async () => {
    const broken = createTestContext({
      searchLimiter: { consume: () => Promise.reject(new Error("redis down")) },
    });
    try {
      const owner = await signUp(broken.app, "limit-broken");
      const orgId = await newOrg(owner, "Broken limiter");
      expect((await search(owner, orgId)).status).toBe(200);
    } finally {
      await broken.close();
    }
  });
});
