import type {
  CreateInventoryItemInput,
  InventoryItemDto,
  InventoryKind,
  UpdateInventoryItemInput,
} from "@closer/shared";
import {
  ATTRIBUTE_SCHEMAS,
  createInventoryItemSchema,
  priceToCents,
  propertyAttributesSchema,
  updateInventoryItemSchema,
  vehicleAttributesSchema,
} from "@closer/shared";
import type { z } from "zod";

type FieldType = "text" | "int" | "decimal" | "enum";
export type AttributeField = {
  name: string;
  type: FieldType;
  required?: boolean;
  options?: readonly string[];
};

const v = vehicleAttributesSchema.shape;
const p = propertyAttributesSchema.shape;

/** Form fields per vertical; enum options come from the shared schemas, never duplicated. */
export const ATTRIBUTE_FIELDS = {
  vehicle: [
    { name: "make", type: "text", required: true },
    { name: "model", type: "text", required: true },
    { name: "year", type: "int", required: true },
    { name: "mileageKm", type: "int" },
    { name: "condition", type: "enum", options: v.condition.unwrap().options },
    { name: "fuel", type: "enum", options: v.fuel.unwrap().options },
    { name: "transmission", type: "enum", options: v.transmission.unwrap().options },
    { name: "color", type: "text" },
  ],
  property: [
    { name: "operation", type: "enum", required: true, options: p.operation.options },
    { name: "propertyType", type: "enum", required: true, options: p.propertyType.options },
    { name: "bedrooms", type: "int" },
    { name: "bathrooms", type: "int" },
    { name: "areaM2", type: "decimal" },
    { name: "neighborhood", type: "text" },
    { name: "city", type: "text" },
    { name: "address", type: "text" },
  ],
  generic: [],
} as const satisfies Record<InventoryKind, readonly AttributeField[]>;

/** Field names (as in the form) whose value was rejected. */
export type FieldErrors = ReadonlySet<string>;

export type BuildResult<T> = { ok: true; body: T } | { ok: false; errors: FieldErrors };

/** Empty means "no price" (null); text that is not a price is undefined. */
export function parsePriceToCents(input: string): number | null | undefined {
  if (input.trim() === "") return null;
  return priceToCents(input) ?? undefined;
}

export function formatCents(cents: number | null): string {
  if (cents === null) return "";
  const units = Math.floor(cents / 100);
  const fraction = cents % 100;
  return fraction === 0 ? String(units) : `${units}.${String(fraction).padStart(2, "0")}`;
}

/** "key: value" per line; blank lines are ignored. */
export function parseGenericAttributes(text: string): Record<string, string> | undefined {
  const entries: [string, string][] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const separator = line.indexOf(":");
    if (separator <= 0) return undefined;
    entries.push([line.slice(0, separator).trim(), line.slice(separator + 1).trim()]);
  }
  return Object.fromEntries(entries);
}

export function formatGenericAttributes(attributes: Record<string, unknown>): string {
  return Object.entries(attributes)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join("\n");
}

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
};

function readAttributes(form: FormData, kind: InventoryKind): Record<string, unknown> | undefined {
  if (kind === "generic") return parseGenericAttributes(text(form, "genericAttributes"));
  const attributes: Record<string, unknown> = {};
  for (const field of ATTRIBUTE_FIELDS[kind]) {
    const raw = text(form, `attr.${field.name}`);
    if (raw === "") continue;
    // NaN is left for the schema to reject, so the error lands on the right field.
    attributes[field.name] = field.type === "int" || field.type === "decimal" ? Number(raw) : raw;
  }
  return attributes;
}

/** Maps a schema issue path back to the form field that produced it. */
function fieldOf(path: readonly PropertyKey[], kind: InventoryKind): string {
  const [head, attribute] = path;
  if (head === "attributes") {
    return kind === "generic" || attribute === undefined
      ? "genericAttributes"
      : `attr.${String(attribute)}`;
  }
  return String(head);
}

const errorsOf = (error: z.ZodError, kind: InventoryKind, prefix: readonly PropertyKey[] = []) =>
  error.issues.map((issue) => fieldOf([...prefix, ...issue.path], kind));

function common(form: FormData) {
  return {
    externalId: text(form, "externalId"),
    title: text(form, "title"),
    description: text(form, "description"),
    price: parsePriceToCents(text(form, "price")),
    currency: text(form, "currency") || "USD",
    status: text(form, "status"),
  };
}

export function buildCreateInput(
  form: FormData,
  kind: InventoryKind,
): BuildResult<CreateInventoryItemInput> {
  const values = common(form);
  const attributes = readAttributes(form, kind);
  const errors = new Set<string>();
  if (values.price === undefined) errors.add("price");
  if (attributes === undefined) errors.add("genericAttributes");

  const parsed = createInventoryItemSchema.safeParse({
    kind,
    title: values.title,
    externalId: values.externalId || undefined,
    description: values.description || undefined,
    priceCents: values.price ?? null,
    currency: values.currency,
    status: values.status || undefined,
    attributes: attributes ?? {},
  });
  if (!parsed.success) for (const field of errorsOf(parsed.error, kind)) errors.add(field);
  if (errors.size > 0 || !parsed.success) return { ok: false, errors };
  return { ok: true, body: parsed.data };
}

/**
 * Full replacement of the editable fields; clearing an optional field sends null.
 * Attributes are checked against the item's kind here too (the API does the same).
 */
export function buildUpdateInput(
  form: FormData,
  item: Pick<InventoryItemDto, "kind">,
): BuildResult<UpdateInventoryItemInput> {
  const values = common(form);
  const attributes = readAttributes(form, item.kind);
  const errors = new Set<string>();
  if (values.price === undefined) errors.add("price");
  if (attributes === undefined) errors.add("genericAttributes");

  const checkedAttributes = ATTRIBUTE_SCHEMAS[item.kind].safeParse(attributes ?? {});
  if (!checkedAttributes.success) {
    for (const field of errorsOf(checkedAttributes.error, item.kind, ["attributes"])) {
      errors.add(field);
    }
  }
  const parsed = updateInventoryItemSchema.safeParse({
    title: values.title,
    externalId: values.externalId || null,
    description: values.description || null,
    priceCents: values.price ?? null,
    currency: values.currency,
    status: values.status,
    attributes: attributes ?? {},
  });
  if (!parsed.success) for (const field of errorsOf(parsed.error, item.kind)) errors.add(field);
  if (errors.size > 0 || !parsed.success) return { ok: false, errors };
  return { ok: true, body: parsed.data };
}
