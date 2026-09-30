import type { Db } from "@closer/db";
import { isUniqueViolation, withTenant } from "@closer/db";
import type { InventoryKind } from "@closer/shared";
import {
  ATTRIBUTE_SCHEMAS,
  INVENTORY_KINDS,
  createInventoryItemSchema,
  listInventoryQuerySchema,
  updateInventoryItemSchema,
} from "@closer/shared";
import { Hono } from "hono";
import type { Auth } from "../auth";
import { AppError, notFound } from "../lib/errors";
import { resourceId } from "../lib/params";
import type { AuthVariables } from "../middleware/require-auth";
import { requireAuth } from "../middleware/require-auth";
import { ANY_ROLE, requireRole } from "../middleware/require-role";
import { validate } from "../middleware/validate";

const duplicateExternalId = () =>
  new AppError("conflict", "An item with this external id already exists");

/** Turns a unique-constraint violation on (org_id, external_id) into a 409. */
async function mapConflicts<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (isUniqueViolation(err)) throw duplicateExternalId();
    throw err;
  }
}

function isInventoryKind(value: string): value is InventoryKind {
  return (INVENTORY_KINDS as readonly string[]).includes(value);
}

/**
 * Inventory scoped to `:orgId`. Any member reads; owners and agents (sales reps, who
 * mark items reserved/sold) write; only owners delete.
 */
export function inventoryRoutes({ auth, db }: { auth: Auth; db: Db }) {
  const r = new Hono<{ Variables: AuthVariables }>();

  r.use("*", requireAuth(auth));

  r.get(
    "/",
    requireRole(db, ...ANY_ROLE),
    validate("query", listInventoryQuerySchema),
    async (c) => {
      const { orgId } = c.get("membership");
      const filter = c.req.valid("query");
      const page = await withTenant(db, orgId, (repo) => repo.inventory.list(filter));
      return c.json({ ...page, limit: filter.limit, offset: filter.offset });
    },
  );

  r.post(
    "/",
    requireRole(db, "owner", "agent"),
    validate("json", createInventoryItemSchema),
    async (c) => {
      const { orgId } = c.get("membership");
      const input = c.req.valid("json");
      const item = await mapConflicts(() =>
        withTenant(db, orgId, (repo) => repo.inventory.create(input)),
      );
      return c.json({ item }, 201);
    },
  );

  r.get("/:itemId", requireRole(db, ...ANY_ROLE), async (c) => {
    const { orgId } = c.get("membership");
    const itemId = resourceId(c.req.param("itemId"), "Item");
    const item = await withTenant(db, orgId, (repo) => repo.inventory.get(itemId));
    if (!item) throw notFound("Item");
    return c.json({ item });
  });

  r.patch(
    "/:itemId",
    requireRole(db, "owner", "agent"),
    validate("json", updateInventoryItemSchema),
    async (c) => {
      const { orgId } = c.get("membership");
      const itemId = resourceId(c.req.param("itemId"), "Item");
      const { attributes, ...patch } = c.req.valid("json");

      const item = await mapConflicts(() =>
        withTenant(db, orgId, async (repo) => {
          const current = await repo.inventory.get(itemId);
          if (!current) throw notFound("Item");

          if (attributes === undefined) return repo.inventory.update(itemId, patch);

          // Attributes are validated against the item's own (immutable) kind.
          if (!isInventoryKind(current.kind)) throw new Error(`Unknown kind ${current.kind}`);
          const parsed = ATTRIBUTE_SCHEMAS[current.kind].safeParse(attributes);
          if (!parsed.success) {
            throw new AppError(
              "validation_error",
              "Invalid request",
              parsed.error.issues.map((i) => ({
                path: ["attributes", ...i.path].join("."),
                message: i.message,
              })),
            );
          }
          return repo.inventory.update(itemId, { ...patch, attributes: parsed.data });
        }),
      );
      if (!item) throw notFound("Item");
      return c.json({ item });
    },
  );

  r.delete("/:itemId", requireRole(db, "owner"), async (c) => {
    const { orgId } = c.get("membership");
    const itemId = resourceId(c.req.param("itemId"), "Item");
    const deleted = await withTenant(db, orgId, (repo) => repo.inventory.delete(itemId));
    if (!deleted) throw notFound("Item");
    return c.body(null, 204);
  });

  return r;
}
