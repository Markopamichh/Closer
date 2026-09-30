import type { CreateInventoryItemInput } from "@closer/shared";
import { CSV_IMPORT_LIMITS, createInventoryItemSchema } from "@closer/shared";
import { parse } from "csv-parse/sync";

/** Columns that map to item fields; every other column is an attribute of the item. */
const BASE_COLUMNS = new Set([
  "external_id",
  "kind",
  "title",
  "description",
  "price",
  "currency",
  "status",
]);

export type ParsedRow = { row: number; item: CreateInventoryItemInput & { externalId: string } };
export type RowError = { row: number; message: string };
export type ParseResult = { rows: ParsedRow[]; errors: RowError[]; totalRows: number };

export class CsvFormatError extends Error {}

const snakeToCamel = (key: string) =>
  key.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());

/** Attribute cells: numbers and booleans are typed, everything else stays text. */
function attributeValue(raw: string): string | number | boolean {
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if (raw === "true" || raw === "false") return raw === "true";
  return raw;
}

/**
 * "18500.5" → 1850050. Parsed from the text, never through a float multiply, so
 * values like 0.29 don't turn into 28 cents.
 */
export function priceToCents(raw: string): number | null {
  const match = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(raw);
  if (!match) return null;
  const [, units = "0", decimals = ""] = match;
  return Number(units) * 100 + Number(decimals.padEnd(2, "0"));
}

/**
 * Parses and validates an inventory CSV with the same schema as the API. Pure: no I/O,
 * so every rule is unit-testable. Row numbers are 1-based spreadsheet rows (header = 1).
 */
export function parseInventoryCsv(text: string): ParseResult {
  let records: Record<string, string>[];
  try {
    records = parse(text, {
      columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()),
      bom: true,
      trim: true,
      skip_empty_lines: true,
      max_record_size: 64 * 1024,
    });
  } catch (err) {
    throw new CsvFormatError(err instanceof Error ? err.message : "Invalid CSV");
  }

  if (records.length === 0) throw new CsvFormatError("The file has no data rows");
  if (records.length > CSV_IMPORT_LIMITS.maxRows) {
    throw new CsvFormatError(`Too many rows (max ${CSV_IMPORT_LIMITS.maxRows})`);
  }
  const headers = Object.keys(records[0] ?? {});
  for (const required of ["external_id", "kind", "title"]) {
    if (!headers.includes(required))
      throw new CsvFormatError(`Missing required column "${required}"`);
  }

  const rows: ParsedRow[] = [];
  const errors: RowError[] = [];
  const seen = new Map<string, number>();

  records.forEach((record, index) => {
    const row = index + 2;
    const externalId = record.external_id ?? "";
    if (!externalId) {
      errors.push({ row, message: "external_id is required for import" });
      return;
    }
    const firstRow = seen.get(externalId);
    if (firstRow !== undefined) {
      errors.push({
        row,
        message: `Duplicate external_id "${externalId}" (first seen on row ${firstRow})`,
      });
      return;
    }
    seen.set(externalId, row);

    let priceCents: number | undefined;
    if (record.price) {
      const cents = priceToCents(record.price);
      if (cents === null) {
        errors.push({
          row,
          message: `Invalid price "${record.price}" (use digits, optional 2 decimals)`,
        });
        return;
      }
      priceCents = cents;
    }

    const attributes: Record<string, string | number | boolean> = {};
    for (const [column, value] of Object.entries(record)) {
      if (!BASE_COLUMNS.has(column) && value !== "")
        attributes[snakeToCamel(column)] = attributeValue(value);
    }

    const parsed = createInventoryItemSchema.safeParse({
      kind: record.kind,
      externalId,
      title: record.title,
      description: record.description || undefined,
      priceCents,
      currency: record.currency || undefined,
      status: record.status || undefined,
      attributes,
    });
    if (!parsed.success) {
      const message = parsed.error.issues
        .map((i) => `${i.path.join(".") || "row"}: ${i.message}`)
        .join("; ");
      errors.push({ row, message });
      return;
    }
    rows.push({ row, item: { ...parsed.data, externalId } });
  });

  return { rows, errors, totalRows: records.length };
}
