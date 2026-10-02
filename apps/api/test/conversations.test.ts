import { createScriptedLlm } from "@closer/ai";
import type { ConversationDetail, ConversationPage } from "@closer/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { World } from "./fixtures";
import { buildWorld } from "./fixtures";
import type { TestContext } from "./helpers";
import { createTestContext, json } from "./helpers";

const llm = createScriptedLlm((request) =>
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
      },
);

let ctx: TestContext;
let w: World;
const base = () => `/api/organizations/${w.orgA}/conversations`;

/** One test-chat exchange; returns the conversation id. */
async function chat(message: string, conversationId?: string) {
  const res = await w.a.owner.request(
    `/api/organizations/${w.orgA}/agents/${w.agentA.id}/test-chat`,
    { method: "POST", body: { message, ...(conversationId ? { conversationId } : {}) } },
  );
  const body = await res.text();
  const id = /"conversationId":"([^"]+)"/.exec(body)?.[1];
  if (res.status !== 200 || !id) throw new Error(`chat failed: ${res.status} ${body}`);
  return id;
}

let older: string;
let newer: string;

beforeAll(async () => {
  ctx = createTestContext({ llm });
  w = await buildWorld(ctx);
  older = await chat("Do you have a Corolla?");
  newer = await chat("Hi again");
  await chat("And financing?", older); // the older one now has the latest activity
});

afterAll(async () => {
  await ctx.close();
});

describe("GET /conversations", () => {
  it("lists newest activity first, with agent, count and preview", async () => {
    const res = await w.a.owner.request(base());
    expect(res.status).toBe(200);
    const page = await json<ConversationPage>(res);

    expect(page.total).toBe(2);
    expect(page.conversations.map((c) => c.id)).toEqual([older, newer]);
    expect(page.conversations[0]).toMatchObject({
      agent: { id: w.agentA.id, name: w.agentA.name },
      channel: "dashboard_test",
      status: "open",
      messageCount: 4,
      lastMessagePreview: "We have a Toyota Corolla 2021.",
    });
  });

  it("paginates and filters", async () => {
    const second = await json<ConversationPage>(
      await w.a.owner.request(`${base()}?limit=1&offset=1`),
    );
    expect(second.conversations.map((c) => c.id)).toEqual([newer]);
    expect(second.total).toBe(2);

    const widget = await json<ConversationPage>(
      await w.a.owner.request(`${base()}?channel=widget`),
    );
    expect(widget).toMatchObject({ total: 0, conversations: [] });

    const otherAgent = await json<ConversationPage>(
      await w.a.owner.request(`${base()}?agentId=${crypto.randomUUID()}`),
    );
    expect(otherAgent.total).toBe(0);
  });

  it("rejects an invalid filter (422)", async () => {
    expect((await w.a.owner.request(`${base()}?channel=email`)).status).toBe(422);
    expect((await w.a.owner.request(`${base()}?limit=1000`)).status).toBe(422);
  });

  it.each(["agent", "viewer"] as const)("%s can read conversations", async (role) => {
    expect((await w.a[role].request(base())).status).toBe(200);
    expect((await w.a[role].request(`${base()}/${older}`)).status).toBe(200);
  });
});

describe("GET /conversations/:id", () => {
  it("returns the thread in order, tool calls per reply (without output) and costs", async () => {
    const res = await w.a.owner.request(`${base()}/${older}`);
    expect(res.status).toBe(200);
    const { conversation } = await json<ConversationDetail>(res);

    expect(conversation.messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(conversation.messages[0]?.content).toBe("Do you have a Corolla?");
    expect(conversation.messages[2]?.content).toBe("And financing?");
    const reply = conversation.messages[1];
    expect(reply?.toolCalls).toEqual([
      expect.objectContaining({
        name: "search_inventory",
        input: { query: "VIN-SHARED-001" },
        status: "success",
      }),
    ]);
    expect(reply?.toolCalls[0]).not.toHaveProperty("output");
    expect(conversation.messages[0]?.costUsd).toBeNull();
    expect(reply?.costUsd).toBeGreaterThan(0);

    const [row] = await ctx.sql`select sum(cost_usd)::float8 as total from ai_traces
      where conversation_id = ${older}`;
    expect(conversation.costUsd).toBeCloseTo(Number(row?.total), 9);
    const replies = conversation.messages.filter((m) => m.role === "assistant");
    const perReply = replies.reduce((total, m) => total + (m.costUsd ?? 0), 0);
    expect(conversation.costUsd).toBeCloseTo(perReply, 9);
  });

  it("is a plain 404 for unknown or malformed ids", async () => {
    const unknown = await w.a.owner.request(`${base()}/${crypto.randomUUID()}`);
    expect(unknown.status).toBe(404);
    expect((await w.a.owner.request(`${base()}/not-a-uuid`)).status).toBe(404);
  });
});
