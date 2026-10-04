import { createScriptedLlm } from "@closer/ai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RateLimiter } from "../src/lib/rate-limit";
import type { World } from "./fixtures";
import { buildWorld } from "./fixtures";
import type { TestContext } from "./helpers";
import { createTestContext, json, signUp } from "./helpers";

const llm = createScriptedLlm(() => ({ text: "Hi! How can I help?" }));

let ctx: TestContext;
let w: World;
let key: string;

const visitor = () => crypto.randomUUID();

/** A widget visitor: no cookie, no session, just the public key and a visitor id. */
function post(body: Record<string, unknown>, publicKey = key, app = ctx.app) {
  return app.request(`/api/public/widget/${publicKey}/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function startConversation(visitorId: string) {
  const res = await post({ visitorId, message: "Hello" });
  const text = await res.text();
  const id = /"conversationId":"([^"]+)"/.exec(text)?.[1];
  if (res.status !== 200 || !id) throw new Error(`widget chat failed: ${res.status} ${text}`);
  return id;
}

const setWidget = (enabled: boolean, active = true) =>
  ctx.sql`update agents set widget_enabled = ${enabled}, is_active = ${active}
    where id = ${w.agentA.id}`;

beforeAll(async () => {
  ctx = createTestContext({ llm });
  w = await buildWorld(ctx);
  const [row] = await ctx.sql<{ public_key: string }[]>`
    select public_key from agents where id = ${w.agentA.id}`;
  key = String(row?.public_key);
  await setWidget(true);
});

afterAll(async () => {
  await setWidget(false);
  await ctx.close();
});

describe("public widget chat", () => {
  it("answers an anonymous visitor and records a widget conversation for them", async () => {
    const visitorId = visitor();
    const conversationId = await startConversation(visitorId);

    const [conversation] = await ctx.sql`
      select org_id, channel, visitor_id from conversations where id = ${conversationId}`;
    expect(conversation).toEqual({ org_id: w.orgA, channel: "widget", visitor_id: visitorId });
    const messages = await ctx.sql`select role from messages
      where conversation_id = ${conversationId} order by created_at`;
    expect(messages.map((m) => String(m.role))).toEqual(["user", "assistant"]);
    const [usage] = await ctx.sql`select metadata from usage_events
      where org_id = ${w.orgA} and metadata->>'conversationId' = ${conversationId}`;
    expect(usage?.metadata).toMatchObject({ channel: "widget" });
  });

  it("the same visitor can continue their conversation", async () => {
    const visitorId = visitor();
    const conversationId = await startConversation(visitorId);
    const res = await post({ visitorId, conversationId, message: "Still there?" });
    expect(res.status).toBe(200);
    await res.text();
  });

  it("another visitor cannot continue it (404, nothing saved)", async () => {
    const conversationId = await startConversation(visitor());
    const res = await post({ visitorId: visitor(), conversationId, message: "Show me the chat" });
    expect(res.status).toBe(404);
    const [row] = await ctx.sql`select count(*)::int as n from messages
      where conversation_id = ${conversationId}`;
    expect(row?.n).toBe(2);
  });

  it("cannot continue a dashboard test conversation", async () => {
    const [test] = await ctx.sql<{ id: string }[]>`
      insert into conversations (org_id, agent_id, channel)
      values (${w.orgA}, ${w.agentA.id}, 'dashboard_test') returning id`;
    const res = await post({ visitorId: visitor(), conversationId: test?.id, message: "hi" });
    expect(res.status).toBe(404);
  });

  it("a widget key never reaches another org's conversation", async () => {
    const [foreign] = await ctx.sql<{ id: string }[]>`
      insert into conversations (org_id, agent_id, channel, visitor_id)
      values (${w.orgB}, ${w.agentB.id}, 'widget', ${"00000000-0000-4000-8000-000000000001"})
      returning id`;
    const res = await post({
      visitorId: "00000000-0000-4000-8000-000000000001",
      conversationId: foreign?.id,
      message: "hi",
    });
    expect(res.status).toBe(404);
  });

  it.each([
    ["malformed", "not-a-key"],
    ["unknown", `pk_${"0".repeat(32)}`],
  ])("a %s key is a plain 404", async (_label, publicKey) => {
    const res = await post({ visitorId: visitor(), message: "hi" }, publicKey);
    expect(res.status).toBe(404);
    expect((await json<{ error: { message: string } }>(res)).error.message).toBe(
      "Widget not found",
    );
  });

  it.each([
    ["disabled", false, true],
    ["on an inactive agent", true, false],
  ])("a widget %s is a plain 404", async (_label, enabled, active) => {
    await setWidget(enabled, active);
    try {
      const res = await post({ visitorId: visitor(), message: "hi" });
      expect(res.status).toBe(404);
    } finally {
      await setWidget(true);
    }
  });

  it("validates the body (422)", async () => {
    expect((await post({ visitorId: "nope", message: "hi" })).status).toBe(422);
    expect((await post({ visitorId: visitor(), message: "" })).status).toBe(422);
  });
});

describe("quotas", () => {
  /** Counts per key, like the Redis limiter: sharing a quota means sharing a key. */
  const limitAfter = (allowed: number): RateLimiter => {
    const used = new Map<string, number>();
    return {
      consume: (key) => {
        const count = (used.get(key) ?? 0) + 1;
        used.set(key, count);
        return Promise.resolve({ allowed: count <= allowed, retryAfterSeconds: 42 });
      },
    };
  };

  it("the daily cap is shared by the test chat and the widget, per org", async () => {
    const isolated = createTestContext({ llm, dailyChatLimiter: limitAfter(1) });
    try {
      // Everything through `isolated.app`, so both channels hit the same capped limiter.
      const owner = await signUp(isolated.app, "cap-owner");
      const created = await owner.request("/api/organizations", {
        method: "POST",
        body: { name: "Cap Motors" },
      });
      const { id: orgId } = await json<{ id: string }>(created);
      const agentRes = await owner.request(`/api/organizations/${orgId}/agents`, {
        method: "POST",
        body: { name: "Capped" },
      });
      const { agent } = await json<{ agent: { id: string } }>(agentRes);
      const [row] = await ctx.sql<{ public_key: string }[]>`
        update agents set widget_enabled = true where id = ${agent.id} returning public_key`;

      const testChat = await owner.request(
        `/api/organizations/${orgId}/agents/${agent.id}/test-chat`,
        { method: "POST", body: { message: "hi" } },
      );
      expect(testChat.status).toBe(200);
      await testChat.text();

      const widget = await post(
        { visitorId: visitor(), message: "hi" },
        row?.public_key,
        isolated.app,
      );
      expect(widget.status).toBe(429);
      expect(widget.headers.get("retry-after")).toBe("42");
      expect((await json<{ error: { message: string } }>(widget)).error.message).toBe(
        "Daily message limit reached",
      );
    } finally {
      await isolated.close();
    }
  });

  it("a visitor over their own limit gets 429", async () => {
    const isolated = createTestContext({ llm, visitorChatLimiter: limitAfter(1) });
    try {
      const visitorId = visitor();
      const first = await post({ visitorId, message: "hi" }, key, isolated.app);
      await first.text();
      expect((await post({ visitorId, message: "again" }, key, isolated.app)).status).toBe(429);
    } finally {
      await isolated.close();
    }
  });

  it("fails closed when the limiter is down (503)", async () => {
    const down: RateLimiter = { consume: () => Promise.reject(new Error("redis down")) };
    const isolated = createTestContext({ llm, dailyChatLimiter: down });
    try {
      const res = await post({ visitorId: visitor(), message: "hi" }, key, isolated.app);
      expect(res.status).toBe(503);
    } finally {
      await isolated.close();
    }
  });
});
