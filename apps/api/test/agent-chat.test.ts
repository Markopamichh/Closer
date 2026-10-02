import type { LlmRequest, ScriptedTurn } from "@closer/ai";
import { createScriptedLlm, LlmError } from "@closer/ai";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { World } from "./fixtures";
import { buildWorld } from "./fixtures";
import type { Client, TestContext } from "./helpers";
import { createTestContext, json, signUp } from "./helpers";

type Script = (request: LlmRequest) => ScriptedTurn;
let script: Script;
const llm = createScriptedLlm((request) => script(request));

let ctx: TestContext;
let w: World;
const chatPath = (orgId = w.orgA, agentId = w.agentA.id) =>
  `/api/organizations/${orgId}/agents/${agentId}/test-chat`;

type SseEvent = { event: string; data: Record<string, unknown> };
function parseSse(body: string): SseEvent[] {
  return body
    .split("\n\n")
    .filter((block) => block.includes("data:"))
    .map((block) => {
      const event = /^event: (.+)$/m.exec(block)?.[1] ?? "message";
      const data = /^data: (.+)$/m.exec(block)?.[1] ?? "{}";
      return { event, data: JSON.parse(data) as Record<string, unknown> };
    });
}

async function chat(client: Client, body: Record<string, unknown>, path = chatPath()) {
  const res = await client.request(path, { method: "POST", body });
  return { res, events: res.status === 200 ? parseSse(await res.text()) : [] };
}

const searchThenAnswer: Script = (request) =>
  request.items.at(-1)?.type === "tool_result"
    ? { text: "We have a Toyota Corolla 2021." }
    : {
        text: "Let me check.",
        toolCalls: [
          {
            callId: "c1",
            name: "search_inventory",
            arguments: JSON.stringify({ query: "VIN-SHARED-001" }),
          },
        ],
      };

beforeAll(async () => {
  ctx = createTestContext({ llm });
  w = await buildWorld(ctx);
});

beforeEach(() => {
  script = searchThenAnswer;
});

afterAll(async () => {
  await ctx.close();
});

describe("test chat", () => {
  it("streams the reply and persists messages, tool calls, traces and usage", async () => {
    const { res, events } = await chat(w.a.owner, { message: "Do you have a Corolla?" });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(events.map((e) => e.event)).toEqual(
      expect.arrayContaining(["start", "tool", "delta", "done"]) as unknown,
    );
    expect(events[0]?.event).toBe("start");
    expect(events.at(-1)?.event).toBe("done");
    const conversationId = String(events[0]?.data.conversationId);
    const streamed = events
      .filter((e) => e.event === "delta")
      .map((e) => String(e.data.text))
      .join("");
    expect(streamed).toBe("Let me check.We have a Toyota Corolla 2021.");
    const done = events.at(-1)?.data as { messageId: string; usage: { costUsd: number } };
    expect(done.usage.costUsd).toBeCloseTo(2 * ((100 * 0.05 + 20 * 0.4) / 1e6), 12);

    const messages = await ctx.sql`select role, content from messages
      where conversation_id = ${conversationId} order by created_at`;
    expect(messages.map((m) => String(m.role))).toEqual(["user", "assistant"]);
    const calls =
      await ctx.sql`select tool_name, status, output from tool_calls where message_id = ${done.messageId}`;
    expect(calls.map((c) => String(c.tool_name))).toEqual(["search_inventory"]);
    // The tool ran for org A only: B's item with the same reference is not there.
    const found = (calls[0]?.output as { items: { id: string }[] }).items.map((i) => i.id);
    expect(found).toEqual([w.itemA.id]);
    const traces =
      await ctx.sql`select status, cost_usd from ai_traces where conversation_id = ${conversationId}`;
    expect(traces).toHaveLength(2);
    expect(traces.every((t) => t.status === "success" && Number(t.cost_usd) > 0)).toBe(true);
    const usage = await ctx.sql`select 1 from usage_events
      where org_id = ${w.orgA} and type = 'ai_message' and metadata->>'conversationId' = ${conversationId}`;
    expect(usage).toHaveLength(1);
  });

  it("continues a conversation with its full history, tool rounds included", async () => {
    const first = await chat(w.a.agent, { message: "Corolla?" });
    const conversationId = String(first.events[0]?.data.conversationId);
    script = () => ({ text: "It has 45,000 km." });

    await chat(w.a.agent, { conversationId, message: "How many km?" });

    expect(llm.requests.at(-1)?.items.map((i) => i.type)).toEqual([
      "user",
      "assistant",
      "tool_call",
      "tool_result",
      "assistant",
      "user",
    ]);
  });

  it("falls back to the plain text when stored history metadata is malformed", async () => {
    const first = await chat(w.a.owner, { message: "Hi" });
    const conversationId = String(first.events[0]?.data.conversationId);
    await ctx.sql`update messages set metadata = '{"items":[{"type":"bogus"}]}'::jsonb
      where conversation_id = ${conversationId} and role = 'assistant'`;
    script = () => ({ text: "ok" });

    const { res } = await chat(w.a.owner, { conversationId, message: "Again" });

    expect(res.status).toBe(200);
    expect(llm.requests.at(-1)?.items).toEqual([
      { type: "user", text: "Hi" },
      { type: "assistant", text: "We have a Toyota Corolla 2021." },
      { type: "user", text: "Again" },
    ]);
  });
});

describe("access", () => {
  it("is 404 for another org's conversation, even under its own agent's id", async () => {
    const b = await chat(w.ownerB, { message: "hello" }, chatPath(w.orgB, w.agentB.id));
    const conversationB = String(b.events[0]?.data.conversationId);
    expect(
      (await chat(w.a.owner, { conversationId: conversationB, message: "x" })).res.status,
    ).toBe(404);
  });

  it("is 404 for a conversation of a different agent of the same org", async () => {
    const created = await w.a.owner.request(`/api/organizations/${w.orgA}/agents`, {
      method: "POST",
      body: { name: "Second agent" },
    });
    const other = (await json<{ agent: { id: string } }>(created)).agent.id;
    const first = await chat(w.a.owner, { message: "hi" }, chatPath(w.orgA, other));
    const conversationId = String(first.events[0]?.data.conversationId);
    expect((await chat(w.a.owner, { conversationId, message: "x" })).res.status).toBe(404);
  });

  it.each([
    ["a viewer", () => w.a.viewer, 403],
    ["a non-member", () => w.outsider, 404],
  ] as const)("rejects %s", async (_label, client, status) => {
    expect((await chat(client(), { message: "hi" })).res.status).toBe(status);
  });

  it("rejects an empty message (422)", async () => {
    expect((await chat(w.a.owner, { message: "   " })).res.status).toBe(422);
  });
});

describe("failures", () => {
  it("reports a provider outage as an error event and keeps the question", async () => {
    script = () => {
      throw new LlmError("OpenAI request failed with status 429", 429);
    };
    const { res, events } = await chat(w.a.owner, { message: "Will this fail?" });

    expect(res.status).toBe(200);
    expect(events.at(-1)).toEqual({ event: "error", data: { code: "unavailable" } });
    const conversationId = String(events[0]?.data.conversationId);
    const messages =
      await ctx.sql`select role from messages where conversation_id = ${conversationId}`;
    expect(messages.map((m) => String(m.role))).toEqual(["user"]);
    const traces =
      await ctx.sql`select status from ai_traces where conversation_id = ${conversationId}`;
    expect(traces.map((t) => String(t.status))).toEqual(["error"]);
  });

  it("cancels the model request when the client disconnects, and saves no reply", async () => {
    let aborted = false;
    const hanging = createTestContext({
      llm: {
        provider: "fake",
        respond: (request) =>
          new Promise((_resolve, reject) => {
            request.signal?.addEventListener("abort", () => {
              aborted = true;
              reject(new Error("aborted"));
            });
          }),
      },
    });
    try {
      const owner = await signUp(hanging.app, "chat-abort");
      const org = await owner.request("/api/organizations", {
        method: "POST",
        body: { name: "Abort" },
      });
      const orgId = (await json<{ id: string }>(org)).id;
      const agent = await owner.request(`/api/organizations/${orgId}/agents`, {
        method: "POST",
        body: { name: "A" },
      });
      const agentId = (await json<{ agent: { id: string } }>(agent)).agent.id;
      const client = new AbortController();
      const res = await owner.request(chatPath(orgId, agentId), {
        method: "POST",
        body: { message: "hi" },
        signal: client.signal,
      });
      const reader = res.body?.getReader();
      await reader?.read(); // the "start" event: the model call is in flight
      client.abort();
      await reader?.cancel().catch(() => undefined);

      await expect.poll(() => aborted, { timeout: 2000 }).toBe(true);
      const replies =
        await hanging.sql`select 1 from messages m join conversations c on c.id = m.conversation_id
        where c.org_id = ${orgId} and m.role = 'assistant'`;
      expect(replies).toHaveLength(0);
    } finally {
      await hanging.close();
    }
  });

  it("answers 503 when no model provider is configured", async () => {
    const offline = createTestContext({ llm: null });
    try {
      const owner = await signUp(offline.app, "chat-offline");
      const org = await owner.request("/api/organizations", {
        method: "POST",
        body: { name: "Offline" },
      });
      const orgId = (await json<{ id: string }>(org)).id;
      const agent = await owner.request(`/api/organizations/${orgId}/agents`, {
        method: "POST",
        body: { name: "A" },
      });
      const agentId = (await json<{ agent: { id: string } }>(agent)).agent.id;
      expect((await chat(owner, { message: "hi" }, chatPath(orgId, agentId))).res.status).toBe(503);
    } finally {
      await offline.close();
    }
  });

  it("limits messages per organization (429 with Retry-After)", async () => {
    const limited = createTestContext({
      llm: createScriptedLlm(() => ({ text: "ok" })),
      chatLimiter: { consume: () => Promise.resolve({ allowed: false, retryAfterSeconds: 42 }) },
    });
    try {
      const owner = await signUp(limited.app, "chat-limited");
      const org = await owner.request("/api/organizations", {
        method: "POST",
        body: { name: "Limited" },
      });
      const orgId = (await json<{ id: string }>(org)).id;
      const agent = await owner.request(`/api/organizations/${orgId}/agents`, {
        method: "POST",
        body: { name: "A" },
      });
      const agentId = (await json<{ agent: { id: string } }>(agent)).agent.id;
      const { res } = await chat(owner, { message: "hi" }, chatPath(orgId, agentId));
      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toBe("42");
    } finally {
      await limited.close();
    }
  });
});
