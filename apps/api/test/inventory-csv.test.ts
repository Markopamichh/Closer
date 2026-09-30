import { describe, expect, it } from "vitest";
import { CsvFormatError, parseInventoryCsv, priceToCents } from "../src/lib/inventory-csv";

const header = "external_id,kind,title,price,make,model,year,mileage_km";

describe("priceToCents", () => {
  it.each([
    ["18500", 1_850_000],
    ["18500.5", 1_850_050],
    ["0.29", 29], // 0.29 * 100 in floating point is 28.999999999999996
    ["1.10", 110],
    ["0", 0],
  ])("%s → %i", (raw, cents) => {
    expect(priceToCents(raw)).toBe(cents);
  });

  it.each(["1,000", "12.345", "-5", "$100", "1e5", "abc", ""])("rejects %j", (raw) => {
    expect(priceToCents(raw)).toBeNull();
  });
});

describe("parseInventoryCsv", () => {
  it("parses vehicles with typed, camelCased attributes", () => {
    const { rows, errors } = parseInventoryCsv(
      `${header}\nVIN-1,vehicle,Corolla XEI,18500.50,Toyota,Corolla,2021,35000\n`,
    );
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({
      row: 2,
      item: {
        kind: "vehicle",
        externalId: "VIN-1",
        priceCents: 1_850_050,
        currency: "USD",
        attributes: { make: "Toyota", model: "Corolla", year: 2021, mileageKm: 35000 },
      },
    });
  });

  it("handles a UTF-8 BOM, messy headers, quoted commas and newlines", () => {
    const csv =
      "﻿ External_ID , KIND ,Title,operation,property_type,description\n" +
      'P-1,property,"Loft, Palermo",rent,apartment,"Bright loft\nnear the park"\n';
    const { rows, errors } = parseInventoryCsv(csv);
    expect(errors).toEqual([]);
    expect(rows[0]?.item).toMatchObject({
      title: "Loft, Palermo",
      description: "Bright loft\nnear the park",
      attributes: { operation: "rent", propertyType: "apartment" },
    });
  });

  it("omits empty cells instead of storing empty strings", () => {
    const { rows } = parseInventoryCsv(`${header}\nVIN-2,vehicle,Ranger,,Ford,Ranger,2022,\n`);
    expect(rows[0]?.item.priceCents).toBeUndefined();
    expect(rows[0]?.item.attributes).not.toHaveProperty("mileageKm");
  });

  it("reports every invalid row with its spreadsheet row number", () => {
    const csv = [
      header,
      "OK-1,vehicle,Fine,100,Toyota,Hilux,2020,1",
      ",vehicle,No id,100,Toyota,Hilux,2020,1",
      "BAD-PRICE,vehicle,Price,1.234,Toyota,Hilux,2020,1",
      "NO-YEAR,vehicle,No year,100,Toyota,Hilux,,1",
      "OK-1,vehicle,Duplicate,100,Toyota,Hilux,2020,1",
      "BOAT-1,boat,Boat,100,,,,",
    ].join("\n");

    const { rows, errors, totalRows } = parseInventoryCsv(csv);

    expect(totalRows).toBe(6);
    expect(rows.map((r) => r.item.externalId)).toEqual(["OK-1"]);
    expect(errors.map((e) => e.row)).toEqual([3, 4, 5, 6, 7]);
    expect(errors[0]?.message).toMatch(/external_id is required/);
    expect(errors[1]?.message).toMatch(/Invalid price/);
    expect(errors[2]?.message).toMatch(/year/);
    expect(errors[3]?.message).toMatch(/first seen on row 2/);
  });

  it.each([
    ["an empty file", ""],
    ["a header without rows", header],
    ["a file without the title column", "external_id,kind\nX,vehicle"],
    ["malformed quoting", `${header}\n"VIN-1,vehicle,Broken`],
  ])("rejects %s as a format error", (_label, csv) => {
    expect(() => parseInventoryCsv(csv)).toThrow(CsvFormatError);
  });

  it("rejects files over the row limit", () => {
    const body = Array.from({ length: 5001 }, (_, i) => `V-${i},generic,Item ${i},,,,,`).join("\n");
    expect(() => parseInventoryCsv(`${header}\n${body}`)).toThrow(/Too many rows/);
  });
});
