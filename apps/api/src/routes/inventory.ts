import type { Db } from "@closer/db";
import { isUniqueViolation, withTenant } from "@closer/db";
import type { CsvImportResult, InventoryKind } from "@closer/shared";
import {
  ATTRIBUTE_SCHEMAS,
  CSV_IMPORT_LIMITS,
  INVENTORY_KINDS,
  createInventoryItemSchema,
  listInventoryQuerySchema,
  updateInventoryItemSchema,
} from "@closer/shared";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import type { Auth } from "../auth";
import { AppError, notFound } from "../lib/errors";
import type { RowError } from "../lib/inventory-csv";
import { CsvFormatError, parseInventoryCsv } from "../lib/inventory-csv";
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

const importQuerySchema = z.object({
  dryRun: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

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

  /**
   * CSV import. All-or-nothing: if any row is invalid nothing is written and the report
   * lists every problem by spreadsheet row. `?dryRun=true` validates and previews only.
   */
  r.post(
    "/import",
    requireRole(db, "owner", "agent"),
    bodyLimit({
      // Multipart overhead on top of the file itself.
      maxSize: CSV_IMPORT_LIMITS.maxBytes + 64 * 1024,
      onError: () => {
        throw new AppError("payload_too_large", "File is too large (max 5 MB)");
      },
    }),
    validate("query", importQuerySchema),
    async (c) => {
      const { orgId } = c.get("membership");
      const { dryRun } = c.req.valid("query");

      const form = await c.req.parseBody();
      const file = form.file;
      if (!(file instanceof File)) {
        throw new AppError("validation_error", 'Upload the CSV as a multipart field named "file"');
      }
      if (file.size > CSV_IMPORT_LIMITS.maxBytes) {
        throw new AppError("payload_too_large", "File is too large (max 5 MB)");
      }

      let parsed;
      try {
        parsed = parseInventoryCsv(await file.text());
      } catch (err) {
        if (err instanceof CsvFormatError) throw new AppError("validation_error", err.message);
        throw err;
      }

      const result = await withTenant(db, orgId, async (repo) => {
        const existing = await repo.inventory.kindsByExternalId(
          parsed.rows.map((r) => r.item.externalId),
        );
        const errors: RowError[] = [...parsed.errors];
        for (const { row, item } of parsed.rows) {
          const currentKind = existing.get(item.externalId);
          if (currentKind && currentKind !== item.kind) {
            errors.push({
              row,
              message: `"${item.externalId}" already exists as ${currentKind}; kind cannot change to ${item.kind}`,
            });
          }
        }
        errors.sort((a, b) => a.row - b.row);

        const report = (applied: boolean, created: number, updated: number): CsvImportResult => ({
          dryRun,
          applied,
          totalRows: parsed.totalRows,
          created,
          updated,
          errors: errors.slice(0, CSV_IMPORT_LIMITS.maxReportedErrors),
          errorsTruncated: errors.length > CSV_IMPORT_LIMITS.maxReportedErrors,
        });

        if (errors.length > 0) return report(false, 0, 0);
        if (dryRun) {
          const updates = parsed.rows.filter((r) => existing.has(r.item.externalId)).length;
          return report(false, parsed.rows.length - updates, updates);
        }
        const counts = await repo.inventory.upsertMany(parsed.rows.map((r) => r.item));
        return report(true, counts.created, counts.updated);
      });

      const failed = result.errors.length > 0;
      if (!failed && result.applied) {
        c.get("logger").info(
          { created: result.created, updated: result.updated },
          "inventory csv imported",
        );
      }
      return c.json(result, failed ? 422 : 200);
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
