import type { AgentTool } from "@closer/ai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createAgentTools } from "../src/agent/tools";
import { processDocument } from "../src/ingestion/process-document";
import type { World } from "./fixtures";
import { buildWorld } from "./fixtures";
import type { TestContext } from "./helpers";
import { createTestContext, json } from "./helpers";

let ctx: TestContext;
let w: World;
let toolsA: AgentTool[];

/** Runs a tool the way the agent loop does: arguments parsed by the tool's own schema. */
async function call(name: string, args: unknown, tools: AgentTool[] = toolsA) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`no tool ${name}`);
  return (await tool.execute(tool.input.parse(args))) as Record<string, unknown>;
}

type Found = { items: { id: string; title: string; status: string; description: string | null }[] };

async function createItem(body: Record<string, unknown>) {
  const res = await w.a.owner.request(`/api/organizations/${w.orgA}/inventory`, {
    method: "POST",
    body: { kind: "vehicle", attributes: { make: "Ford", model: "Ranger", year: 2020 }, ...body },
  });
  expect(res.status).toBe(201);
  return (await json<{ item: { id: string } }>(res)).item;
}

beforeAll(async () => {
  ctx = createTestContext();
  w = await buildWorld(ctx);
  toolsA = createAgentTools({
    db: ctx.db,
    orgId: w.orgA,
    conversationId: crypto.randomUUID(),
    embedder: ctx.embedder,
  });
  for (const [orgId, documentId] of [
    [w.orgA, w.docA.id],
    [w.orgB, w.docB.id],
  ] as const) {
    await processDocument(
      { db: ctx.db, storage: ctx.storage, embedder: ctx.embedder, logger: ctx.logger },
      { orgId, documentId, attempt: 1, maxAttempts: 1 },
    );
  }
});

afterAll(async () => {
  await ctx.close();
});

describe("tool definitions", () => {
  // The provider gets each schema as JSON Schema; a .transform or .refine-only shape that
  // Zod can't express breaks every chat turn, not just this tool.
  it("every tool's input converts to JSON Schema", () => {
    for (const tool of toolsA) {
      expect(() => z.toJSONSchema(tool.input), tool.name).not.toThrow();
    }
  });
});

describe("tenant isolation", () => {
  it("search_inventory never returns another org's items, even with the same reference", async () => {
    const found = (await call("search_inventory", { query: "VIN-SHARED-001" })) as Found;
    expect(found.items.map((i) => i.id)).toEqual([w.itemA.id]);
  });

  it("get_inventory_item cannot read another org's item by id", async () => {
    expect(await call("get_inventory_item", { id: w.itemB.id })).toEqual({
      error: "No item with that id",
    });
  });

  it("an orgId smuggled into the arguments is ignored", async () => {
    const found = (await call("search_inventory", {
      query: "VIN-SHARED-001",
      orgId: w.orgB,
    })) as Found;
    expect(found.items.map((i) => i.id)).toEqual([w.itemA.id]);
  });

  it("search_knowledge only returns this org's documents", async () => {
    const own = (await call("search_knowledge", { query: "financing month plans" })) as {
      passages: { document: string }[];
    };
    expect(own.passages.map((p) => p.document)).toContain("financing.md");
    const other = (await call("search_knowledge", { query: "rentals guarantors" })) as {
      passages: { document: string }[];
    };
    expect(other.passages.map((p) => p.document)).not.toContain("rentals.md");
  });
});

describe("business rules", () => {
  it("search_inventory only offers available items; get_inventory_item tells their status", async () => {
    const sold = await createItem({ title: "Sold Ranger TOOLTEST", status: "sold" });
    const found = (await call("search_inventory", { query: "TOOLTEST" })) as Found;
    expect(found.items.map((i) => i.id)).not.toContain(sold.id);
    expect(await call("get_inventory_item", { id: sold.id })).toMatchObject({ status: "sold" });
  });

  it("filters by price range in major units", async () => {
    const cheap = await createItem({ title: "Cheap PRICETEST", priceCents: 1_850_000 });
    const pricey = await createItem({ title: "Pricey PRICETEST", priceCents: 5_000_000 });
    const under = (await call("search_inventory", {
      query: "PRICETEST",
      maxPrice: 25000,
    })) as Found;
    expect(under.items.map((i) => i.id)).toEqual([cheap.id]);
    const over = (await call("search_inventory", { query: "PRICETEST", minPrice: 25000 })) as Found;
    expect(over.items.map((i) => i.id)).toEqual([pricey.id]);
  });

  it("when a literal query matches nothing, it browses the same filters and says so", async () => {
    const cheap = await createItem({ title: "Nissan Sentra FALLBACK", priceCents: 1_500_000 });
    const empty = (await call("search_inventory", {
      query: "sedan",
      kind: "vehicle",
      maxPrice: 16000,
    })) as Found & { note?: string };
    expect(empty.items.map((i) => i.id)).toContain(cheap.id);
    expect(empty.items.every((i) => i.status === "available")).toBe(true);
    expect(empty.note).toContain('"sedan"');

    const matched = (await call("search_inventory", { query: "FALLBACK" })) as Found;
    expect(matched).not.toHaveProperty("note");
    const browse = await call("search_inventory", { kind: "vehicle" });
    expect(browse).not.toHaveProperty("note");
  });

  it("an empty query means no text filter, not an error", async () => {
    const result = (await call("search_inventory", { query: "", kind: "vehicle" })) as Found;
    expect(result.items.length).toBeGreaterThan(0);
    expect(result).not.toHaveProperty("note");
  });

  it("the fallback keeps the price filter (no items outside the asked range)", async () => {
    const result = (await call("search_inventory", {
      query: "nothing-matches-this",
      minPrice: 999_999_000,
    })) as Found;
    expect(result.items).toEqual([]);
  });

  it("clips long descriptions in search results", async () => {
    await createItem({ title: "Long CLIPTEST", description: "x".repeat(1000) });
    const found = (await call("search_inventory", { query: "CLIPTEST" })) as Found;
    expect(found.items[0]?.description?.length).toBeLessThanOrEqual(301);
  });

  it("records the knowledge search embedding as agent usage", async () => {
    const before = await ctx.sql`select count(*)::int as n from usage_events
      where org_id = ${w.orgA} and type = 'embedding' and metadata->>'source' = 'agent'`;
    await call("search_knowledge", { query: "opening hours" });
    const after = await ctx.sql`select count(*)::int as n from usage_events
      where org_id = ${w.orgA} and type = 'embedding' and metadata->>'source' = 'agent'`;
    expect(after[0]?.n).toBe((before[0]?.n as number) + 1);
  });
});
