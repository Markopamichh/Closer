import { and, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { Tx } from "../client";
import { inventoryItems } from "../schema";

type Item = typeof inventoryItems.$inferSelect;
export type NewInventoryItem = Omit<
  typeof inventoryItems.$inferInsert,
  "id" | "orgId" | "createdAt" | "updatedAt"
>;
export type InventoryItemPatch = Partial<Omit<NewInventoryItem, "kind">>;

export type InventoryFilter = {
  status?: Item["status"];
  kind?: string;
  /** Case-insensitive substring match on title or external id. */
  q?: string;
  limit: number;
  offset: number;
};

/** Escapes LIKE wildcards so a search for "50%" means the literal text "50%". */
export const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

export function inventoryRepo(tx: Tx, orgId: string) {
  const scope = (id: string) => and(eq(inventoryItems.orgId, orgId), eq(inventoryItems.id, id));

  return {
    list: async (filter: InventoryFilter) => {
      const conditions: (SQL | undefined)[] = [eq(inventoryItems.orgId, orgId)];
      if (filter.status) conditions.push(eq(inventoryItems.status, filter.status));
      if (filter.kind) conditions.push(eq(inventoryItems.kind, filter.kind));
      if (filter.q) {
        const pattern = `%${escapeLike(filter.q)}%`;
        conditions.push(
          or(ilike(inventoryItems.title, pattern), ilike(inventoryItems.externalId, pattern)),
        );
      }
      const where = and(...conditions);

      const [items, [totals]] = await Promise.all([
        tx
          .select()
          .from(inventoryItems)
          .where(where)
          // id as a tiebreaker keeps pagination stable when timestamps collide.
          .orderBy(desc(inventoryItems.createdAt), desc(inventoryItems.id))
          .limit(filter.limit)
          .offset(filter.offset),
        tx.select({ total: count() }).from(inventoryItems).where(where),
      ]);
      return { items, total: totals?.total ?? 0 };
    },

    get: async (id: string) => {
      const [row] = await tx.select().from(inventoryItems).where(scope(id));
      return row ?? null;
    },

    create: async (input: NewInventoryItem) => {
      const [row] = await tx
        .insert(inventoryItems)
        .values({ ...input, orgId })
        .returning();
      if (!row) throw new Error("inventory.create: insert returned no row");
      return row;
    },

    update: async (id: string, patch: InventoryItemPatch) => {
      const [row] = await tx.update(inventoryItems).set(patch).where(scope(id)).returning();
      return row ?? null;
    },

    /** kind of existing items by external id, to reject imports that would change it. */
    kindsByExternalId: async (externalIds: string[]) => {
      if (externalIds.length === 0) return new Map<string, string>();
      const rows = await tx
        .select({ externalId: inventoryItems.externalId, kind: inventoryItems.kind })
        .from(inventoryItems)
        .where(
          and(eq(inventoryItems.orgId, orgId), inArray(inventoryItems.externalId, externalIds)),
        );
      return new Map(rows.flatMap((r) => (r.externalId ? [[r.externalId, r.kind] as const] : [])));
    },

    /**
     * Inserts or replaces items keyed by (org_id, external_id). Each row is the full
     * source of truth for the item's fields. Returns how many were created vs updated.
     */
    upsertMany: async (items: (NewInventoryItem & { externalId: string })[]) => {
      let created = 0;
      let updated = 0;
      const BATCH = 500;
      for (let i = 0; i < items.length; i += BATCH) {
        const batch = items.slice(i, i + BATCH).map((item) => ({
          ...item,
          description: item.description ?? null,
          priceCents: item.priceCents ?? null,
          orgId,
        }));
        const rows = await tx
          .insert(inventoryItems)
          .values(batch)
          .onConflictDoUpdate({
            target: [inventoryItems.orgId, inventoryItems.externalId],
            set: {
              title: sql`excluded.title`,
              description: sql`excluded.description`,
              priceCents: sql`excluded.price_cents`,
              currency: sql`excluded.currency`,
              status: sql`excluded.status`,
              attributes: sql`excluded.attributes`,
              updatedAt: sql`now()`,
            },
          })
          // xmax is 0 for a freshly inserted row and non-zero for one updated in place.
          .returning({ inserted: sql<boolean>`(xmax = 0)` });
        for (const row of rows) {
          if (row.inserted) created++;
          else updated++;
        }
      }
      return { created, updated };
    },

    delete: async (id: string) => {
      const rows = await tx
        .delete(inventoryItems)
        .where(scope(id))
        .returning({ id: inventoryItems.id });
      return rows.length > 0;
    },
  };
}
