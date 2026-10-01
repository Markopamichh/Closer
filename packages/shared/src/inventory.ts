import { z } from "zod";

export const INVENTORY_KINDS = ["vehicle", "property", "generic"] as const;
export type InventoryKind = (typeof INVENTORY_KINDS)[number];

export const INVENTORY_STATUSES = ["available", "reserved", "sold", "archived"] as const;
export type InventoryStatus = (typeof INVENTORY_STATUSES)[number];

/**
 * "18500.5" → 1850050, or null when the text is not a price. Parsed from the text, never
 * through a float multiply: `19.99 * 100` is 1998.9999999999998. Up to 10 integer digits
 * keeps every accepted value under the schema max (1e12 cents).
 */
export function priceToCents(raw: string): number | null {
  const match = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(raw.trim());
  if (!match) return null;
  const [, units = "0", decimals = ""] = match;
  return Number(units) * 100 + Number(decimals.padEnd(2, "0"));
}

const optionalText = (max: number) => z.string().trim().min(1).max(max).optional();
const nonNegativeInt = z.number().int().nonnegative();

// Per-vertical attributes. `.strict()` keeps typos ("milage") from silently becoming
// data the agent will later read and repeat to customers.

export const vehicleAttributesSchema = z
  .object({
    make: z.string().trim().min(1).max(60),
    model: z.string().trim().min(1).max(60),
    year: z
      .number()
      .int()
      .min(1900)
      .max(new Date().getFullYear() + 1),
    mileageKm: nonNegativeInt.optional(),
    fuel: z.enum(["gasoline", "diesel", "hybrid", "electric", "other"]).optional(),
    transmission: z.enum(["manual", "automatic"]).optional(),
    color: optionalText(40),
    condition: z.enum(["new", "used"]).optional(),
  })
  .strict();

export const propertyAttributesSchema = z
  .object({
    operation: z.enum(["sale", "rent"]),
    propertyType: z.enum(["apartment", "house", "land", "commercial", "office"]),
    bedrooms: nonNegativeInt.optional(),
    bathrooms: nonNegativeInt.optional(),
    areaM2: z.number().positive().optional(),
    neighborhood: optionalText(80),
    city: optionalText(80),
    address: optionalText(160),
  })
  .strict();

/** Free-form for other verticals: flat scalar values only, bounded in size. */
export const genericAttributesSchema = z
  .record(z.string().trim().min(1).max(40), z.union([z.string().max(200), z.number(), z.boolean()]))
  .refine((v) => Object.keys(v).length <= 30, { message: "At most 30 attributes" });

export const ATTRIBUTE_SCHEMAS = {
  vehicle: vehicleAttributesSchema,
  property: propertyAttributesSchema,
  generic: genericAttributesSchema,
} satisfies Record<InventoryKind, z.ZodType>;

const baseFields = {
  /** SKU, VIN or listing code; unique per org, used to upsert on CSV import. */
  externalId: optionalText(100),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).optional(),
  /** Integer minor units (cents) to avoid floating-point money. */
  priceCents: z.number().int().nonnegative().max(1e12).nullable().optional(),
  currency: z
    .string()
    .trim()
    .length(3)
    .transform((c) => c.toUpperCase())
    .default("USD"),
  status: z.enum(INVENTORY_STATUSES).default("available"),
};

export const createInventoryItemSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("vehicle"), attributes: vehicleAttributesSchema, ...baseFields }),
  z.object({ kind: z.literal("property"), attributes: propertyAttributesSchema, ...baseFields }),
  z.object({
    kind: z.literal("generic"),
    attributes: genericAttributesSchema.default({}),
    ...baseFields,
  }),
]);
export type CreateInventoryItemInput = z.infer<typeof createInventoryItemSchema>;

/**
 * `kind` is immutable (it defines what the attributes mean) and is rejected here.
 * `attributes`, when present, replaces the whole object and is validated against the
 * item's existing kind by the API.
 */
export const updateInventoryItemSchema = z
  .object({
    externalId: z.string().trim().min(1).max(100).nullable(),
    title: baseFields.title,
    description: z.string().trim().max(5000).nullable(),
    priceCents: z.number().int().nonnegative().max(1e12).nullable(),
    currency: z
      .string()
      .trim()
      .length(3)
      .transform((c) => c.toUpperCase()),
    status: z.enum(INVENTORY_STATUSES),
    attributes: z.record(z.string(), z.unknown()),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "At least one field is required" });
export type UpdateInventoryItemInput = z.infer<typeof updateInventoryItemSchema>;

export const listInventoryQuerySchema = z.object({
  status: z.enum(INVENTORY_STATUSES).optional(),
  kind: z.enum(INVENTORY_KINDS).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});
export type ListInventoryQuery = z.infer<typeof listInventoryQuerySchema>;

export const CSV_IMPORT_LIMITS = {
  maxBytes: 5 * 1024 * 1024,
  maxRows: 5000,
  maxReportedErrors: 100,
};

export const csvImportResultSchema = z.object({
  dryRun: z.boolean(),
  /** False when any row failed validation: nothing is written (all-or-nothing). */
  applied: z.boolean(),
  totalRows: z.number().int(),
  created: z.number().int(),
  updated: z.number().int(),
  errors: z.array(z.object({ row: z.number().int(), message: z.string() })),
  /** True when more errors existed than were reported. */
  errorsTruncated: z.boolean(),
});
export type CsvImportResult = z.infer<typeof csvImportResultSchema>;

/** Item as the web reads it; unknown fields in the API response are stripped. */
export const inventoryItemSchema = z.object({
  id: z.uuid(),
  kind: z.enum(INVENTORY_KINDS),
  externalId: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  priceCents: z.number().int().nullable(),
  currency: z.string(),
  status: z.enum(INVENTORY_STATUSES),
  attributes: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type InventoryItemDto = z.infer<typeof inventoryItemSchema>;

export const inventoryPageSchema = z.object({
  items: z.array(inventoryItemSchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});
export type InventoryPage = z.infer<typeof inventoryPageSchema>;

export const inventoryItemResponseSchema = z.object({ item: inventoryItemSchema });
