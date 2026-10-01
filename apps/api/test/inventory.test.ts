import { inventoryItemSchema, inventoryPageSchema } from "@closer/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { World } from "./fixtures";
import { buildWorld } from "./fixtures";
import type { TestContext } from "./helpers";
import { createTestContext, json } from "./helpers";

type Item = {
  id: string;
  kind: string;
  title: string;
  externalId: string | null;
  currency: string;
  status: string;
  priceCents: number | null;
  attributes: Record<string, unknown>;
};
type Page = { items: Item[]; total: number; limit: number; offset: number };
type ErrorBody = { error: { code: string; details?: { path: string }[] } };

let ctx: TestContext;
let w: World;
const base = () => `/api/organizations/${w.orgA}/inventory`;
const owner = () => w.a.owner;

async function create(body: Record<string, unknown>) {
  return owner().request(base(), { method: "POST", body });
}

async function createOk(body: Record<string, unknown>): Promise<Item> {
  const res = await create(body);
  expect(res.status).toBe(201);
  return (await json<{ item: Item }>(res)).item;
}

const car = (title: string, extra: Record<string, unknown> = {}) => ({
  kind: "vehicle",
  title,
  attributes: { make: "Toyota", model: "Hilux", year: 2023 },
  ...extra,
});

beforeAll(async () => {
  ctx = createTestContext();
  w = await buildWorld(ctx);
});

afterAll(async () => {
  await ctx.close();
});

describe("creating items", () => {
  it("stores a vehicle with typed attributes and normalizes the currency", async () => {
    const item = await createOk(
      car("Hilux SRV", {
        currency: "usd",
        priceCents: 4_200_000,
        attributes: {
          make: "Toyota",
          model: "Hilux",
          year: 2023,
          mileageKm: 12000,
          fuel: "diesel",
        },
      }),
    );
    expect(item).toMatchObject({
      kind: "vehicle",
      currency: "USD",
      status: "available",
      priceCents: 4_200_000,
    });
    expect(item.attributes).toEqual({
      make: "Toyota",
      model: "Hilux",
      year: 2023,
      mileageKm: 12000,
      fuel: "diesel",
    });
  });

  it("stores a property", async () => {
    const item = await createOk({
      kind: "property",
      title: "2-bedroom apartment in Palermo",
      attributes: { operation: "rent", propertyType: "apartment", bedrooms: 2, areaM2: 65 },
    });
    expect(item.kind).toBe("property");
  });

  it.each([
    [
      "a vehicle without year",
      car("x", { attributes: { make: "A", model: "B" } }),
      "attributes.year",
    ],
    [
      "a misspelled vehicle attribute",
      car("x", { attributes: { make: "A", model: "B", year: 2020, milage: 10 } }),
      "attributes",
    ],
    ["a negative price", car("x", { priceCents: -1 }), "priceCents"],
    ["a fractional price", car("x", { priceCents: 10.5 }), "priceCents"],
    ["an unknown kind", { kind: "boat", title: "x", attributes: {} }, "kind"],
    [
      "vehicle attributes on a property",
      { kind: "property", title: "x", attributes: { make: "A", model: "B", year: 2020 } },
      "attributes",
    ],
  ])("rejects %s (422)", async (_label, body, path) => {
    const res = await create(body);
    expect(res.status).toBe(422);
    const { error } = await json<ErrorBody>(res);
    expect(error.details?.some((d) => d.path.startsWith(path))).toBe(true);
  });

  it("rejects a duplicate external id within the same org (409)", async () => {
    await createOk(car("First", { externalId: "DUP-1" }));
    const res = await create(car("Second", { externalId: "DUP-1" }));
    expect(res.status).toBe(409);
    expect((await json<ErrorBody>(res)).error.code).toBe("conflict");
  });

  it("allows items without external id (no uniqueness clash on NULL)", async () => {
    await createOk(car("No SKU 1"));
    await createOk(car("No SKU 2"));
  });
});

describe("updating items", () => {
  it("updates status and price", async () => {
    const item = await createOk(car("To update", { priceCents: 100 }));
    const res = await owner().request(`${base()}/${item.id}`, {
      method: "PATCH",
      body: { status: "sold", priceCents: 90 },
    });
    expect(res.status).toBe(200);
    expect((await json<{ item: Item }>(res)).item).toMatchObject({
      status: "sold",
      priceCents: 90,
    });
  });

  it("validates new attributes against the item's existing kind", async () => {
    const item = await createOk(car("Kind check"));
    const bad = await owner().request(`${base()}/${item.id}`, {
      method: "PATCH",
      body: { attributes: { operation: "rent", propertyType: "house" } },
    });
    expect(bad.status).toBe(422);

    const good = await owner().request(`${base()}/${item.id}`, {
      method: "PATCH",
      body: { attributes: { make: "Toyota", model: "Hilux", year: 2024 } },
    });
    expect(good.status).toBe(200);
    expect((await json<{ item: Item }>(good)).item.attributes).toMatchObject({ year: 2024 });
  });

  it("rejects changing the kind (422)", async () => {
    const item = await createOk(car("Immutable kind"));
    const res = await owner().request(`${base()}/${item.id}`, {
      method: "PATCH",
      body: { kind: "property" },
    });
    expect(res.status).toBe(422);
  });

  it("returns 409 when the new external id is already taken", async () => {
    await createOk(car("Holder", { externalId: "TAKEN-1" }));
    const item = await createOk(car("Mover", { externalId: "FREE-1" }));
    const res = await owner().request(`${base()}/${item.id}`, {
      method: "PATCH",
      body: { externalId: "TAKEN-1" },
    });
    expect(res.status).toBe(409);
  });

  it("returns 404 for an id that does not exist", async () => {
    const res = await owner().request(`${base()}/${crypto.randomUUID()}`, {
      method: "PATCH",
      body: { status: "sold" },
    });
    expect(res.status).toBe(404);
  });
});

describe("listing items", () => {
  let tag: string;

  beforeAll(async () => {
    tag = `LIST${Date.now().toString(36)}`;
    for (let i = 0; i < 5; i++) {
      await createOk(
        car(`${tag} truck ${i}`, {
          externalId: `${tag}-${i}`,
          status: i < 2 ? "sold" : "available",
        }),
      );
    }
    await createOk(car(`${tag} 50% off`, { externalId: `${tag}-promo` }));
  });

  const list = async (query: string) => {
    const res = await owner().request(`${base()}?${query}`);
    expect(res.status).toBe(200);
    return json<Page>(res);
  };

  it("searches title and external id case-insensitively", async () => {
    expect((await list(`q=${tag.toLowerCase()}`)).total).toBe(6);
    expect((await list(`q=${tag}-3`)).items.map((i) => i.externalId)).toEqual([`${tag}-3`]);
  });

  it("treats % in the search as a literal character, not a wildcard", async () => {
    const page = await list(`q=${encodeURIComponent(`${tag} 50%`)}`);
    expect(page.items.map((i) => i.title)).toEqual([`${tag} 50% off`]);

    const wildcardOnly = await list(`q=${encodeURIComponent("%")}&limit=100`);
    expect(wildcardOnly.items.every((i) => i.title.includes("%"))).toBe(true);
  });

  it("filters by status", async () => {
    const page = await list(`q=${tag}&status=sold`);
    expect(page.total).toBe(2);
    expect(page.items.every((i) => i.status === "sold")).toBe(true);
  });

  it("paginates with a stable order and an accurate total", async () => {
    const first = await list(`q=${tag}&limit=4&offset=0`);
    const second = await list(`q=${tag}&limit=4&offset=4`);
    expect(first.total).toBe(6);
    expect(first.items).toHaveLength(4);
    expect(second.items).toHaveLength(2);
    const ids = [...first.items, ...second.items].map((i) => i.id);
    expect(new Set(ids).size).toBe(6);
  });

  it.each(["limit=0", "limit=101", "offset=-1", "status=stolen", "kind=boat"])(
    "rejects an invalid query (%s → 422)",
    async (query) => {
      const res = await owner().request(`${base()}?${query}`);
      expect(res.status).toBe(422);
    },
  );
});

describe("response shape", () => {
  it("every endpoint returns the public item shape, never org_id", async () => {
    const created = await create(car("Shape check", { externalId: `SHAPE-${Date.now()}` }));
    const { item } = await json<{ item: Record<string, unknown> }>(created);
    const path = `${base()}/${String(item.id)}`;
    const responses = [
      item,
      (await json<{ item: unknown }>(await owner().request(path))).item,
      (
        await json<{ item: unknown }>(
          await owner().request(path, { method: "PATCH", body: { status: "reserved" } }),
        )
      ).item,
    ];
    for (const body of responses) {
      expect(body).not.toHaveProperty("orgId");
      expect(inventoryItemSchema.strict().safeParse(body).success).toBe(true);
    }
    const page = await json<{ items: Record<string, unknown>[] }>(await owner().request(base()));
    expect(page.items.some((i) => "orgId" in i)).toBe(false);
    expect(inventoryPageSchema.safeParse(page).success).toBe(true);
  });
});
