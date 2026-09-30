import type { CsvImportResult } from "@closer/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { World } from "./fixtures";
import { buildWorld } from "./fixtures";
import type { Client, TestContext } from "./helpers";
import { createTestContext, csvForm, json } from "./helpers";

let ctx: TestContext;
let w: World;

const importPath = (orgId: string, dryRun = false) =>
  `/api/organizations/${orgId}/inventory/import${dryRun ? "?dryRun=true" : ""}`;

const header = "external_id,kind,title,price,status,make,model,year";
let seq = 0;
/** Unique external ids per test so tests don't depend on each other's data. */
const uid = () => `IMP-${Date.now().toString(36)}-${(seq++).toString(36)}`;
const carRow = (id: string, title = "Corolla", price = "18500") =>
  `${id},vehicle,${title},${price},available,Toyota,Corolla,2021`;

async function importCsv(client: Client, orgId: string, csv: string, dryRun = false) {
  const res = await client.upload(importPath(orgId, dryRun), csvForm(csv));
  return {
    status: res.status,
    body: await json<CsvImportResult & { error?: { code: string } }>(res),
  };
}

type ItemRow = { external_id: string; org_id: string; title: string; price_cents: number | null };

const itemsByExternalId = (orgId: string, ids: string[]) => ctx.sql<ItemRow[]>`
  select external_id, org_id, title, price_cents::int as price_cents from inventory_items
  where org_id = ${orgId} and external_id in ${ctx.sql(ids)} order by external_id`;

beforeAll(async () => {
  ctx = createTestContext();
  w = await buildWorld(ctx);
});

afterAll(async () => {
  await ctx.close();
});

describe("CSV import", () => {
  it("creates items and reports counts", async () => {
    const [a, b] = [uid(), uid()];
    const { status, body } = await importCsv(
      w.a.owner,
      w.orgA,
      [header, carRow(a), carRow(b)].join("\n"),
    );

    expect(status).toBe(200);
    expect(body).toMatchObject({
      applied: true,
      dryRun: false,
      totalRows: 2,
      created: 2,
      updated: 0,
      errors: [],
    });
    expect(await itemsByExternalId(w.orgA, [a, b])).toHaveLength(2);
  });

  it("re-importing updates existing items in place (upsert by external_id)", async () => {
    const id = uid();
    await importCsv(w.a.owner, w.orgA, [header, carRow(id, "Old title", "100")].join("\n"));

    const { body } = await importCsv(
      w.a.owner,
      w.orgA,
      [header, carRow(id, "New title", "200.50")].join("\n"),
    );

    expect(body).toMatchObject({ created: 0, updated: 1 });
    const [row] = await itemsByExternalId(w.orgA, [id]);
    expect(row).toMatchObject({ title: "New title", price_cents: 20050 });
  });

  it("is all-or-nothing: one invalid row means nothing is written (422 + report)", async () => {
    const [good, bad] = [uid(), uid()];
    const csv = [header, carRow(good), `${bad},vehicle,No year,100,available,Toyota,Corolla,`].join(
      "\n",
    );

    const { status, body } = await importCsv(w.a.owner, w.orgA, csv);

    expect(status).toBe(422);
    expect(body).toMatchObject({ applied: false, created: 0, updated: 0 });
    expect(body.errors).toEqual([expect.objectContaining({ row: 3 })]);
    expect(await itemsByExternalId(w.orgA, [good, bad])).toHaveLength(0);
  });

  it("dry run previews creates and updates without writing", async () => {
    const existing = uid();
    await importCsv(w.a.owner, w.orgA, [header, carRow(existing, "Before")].join("\n"));
    const fresh = uid();

    const { status, body } = await importCsv(
      w.a.owner,
      w.orgA,
      [header, carRow(existing, "After"), carRow(fresh)].join("\n"),
      true,
    );

    expect(status).toBe(200);
    expect(body).toMatchObject({ dryRun: true, applied: false, created: 1, updated: 1 });
    const rows = await itemsByExternalId(w.orgA, [existing, fresh]);
    expect(rows.map((r) => r.title)).toEqual(["Before"]);
  });

  it("refuses to change the kind of an existing item", async () => {
    const id = uid();
    await importCsv(w.a.owner, w.orgA, [header, carRow(id)].join("\n"));
    const csv = `external_id,kind,title,operation,property_type\n${id},property,Now a flat,rent,apartment`;

    const { status, body } = await importCsv(w.a.owner, w.orgA, csv);

    expect(status).toBe(422);
    expect(body.errors[0]?.message).toMatch(/kind cannot change/);
  });

  it("an external id that exists in another org creates a new item in the caller's org", async () => {
    // itemB in org B uses VIN-SHARED-001, and so does itemA in org A.
    const before =
      await ctx.sql`select title, updated_at from inventory_items where id = ${w.itemB.id}`;

    const { body } = await importCsv(
      w.a.owner,
      w.orgA,
      [header, carRow("VIN-SHARED-001", "Updated by A")].join("\n"),
    );

    expect(body).toMatchObject({ applied: true, updated: 1, created: 0 });
    const [a] = await ctx.sql`select title from inventory_items where id = ${w.itemA.id}`;
    expect(a?.title).toBe("Updated by A");
    expect(
      await ctx.sql`select title, updated_at from inventory_items where id = ${w.itemB.id}`,
    ).toEqual(before);
  });

  it.each([
    ["owner", 200],
    ["agent", 200],
    ["viewer", 403],
  ] as const)("%s importing → %i", async (role, status) => {
    const res = await w.a[role].upload(
      importPath(w.orgA),
      csvForm([header, carRow(uid())].join("\n")),
    );
    expect(res.status).toBe(status);
  });

  it("a user of org A cannot import into org B (404, nothing written)", async () => {
    const id = uid();
    const res = await w.a.owner.upload(
      importPath(w.orgB),
      csvForm([header, carRow(id)].join("\n")),
    );
    expect(res.status).toBe(404);
    expect(await itemsByExternalId(w.orgB, [id])).toHaveLength(0);
  });

  it("rejects files over 5 MB (413)", async () => {
    const big = `${header}\n${"x".repeat(5 * 1024 * 1024 + 10)}`;
    const res = await w.a.owner.upload(importPath(w.orgA), csvForm(big));
    expect(res.status).toBe(413);
  });

  it.each([
    ["no file field", () => csvForm("a,b", "document")],
    ["a CSV without required columns", () => csvForm("sku,name\n1,x")],
  ])("rejects %s (422)", async (_label, form) => {
    const res = await w.a.owner.upload(importPath(w.orgA), form());
    expect(res.status).toBe(422);
  });
});
