import { describe, expect, it } from "vitest";
import {
  buildCreateInput,
  buildUpdateInput,
  formatCents,
  formatGenericAttributes,
  parseGenericAttributes,
  parsePriceToCents,
} from "./inventory-form";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

describe("parsePriceToCents", () => {
  it.each([
    ["18500", 1_850_000],
    ["18500.5", 1_850_050],
    ["19.99", 1999],
    ["0.07", 7],
    ["  42 ", 4200],
  ])("%s → %i cents", (input, cents) => {
    expect(parsePriceToCents(input)).toBe(cents);
  });

  it("treats an empty price as no price", () => {
    expect(parsePriceToCents("")).toBeNull();
  });

  it.each(["-1", "1.999", "1,5", "abc", "1e5"])("rejects %s", (input) => {
    expect(parsePriceToCents(input)).toBeUndefined();
  });

  it("round-trips through formatCents", () => {
    for (const cents of [0, 7, 1999, 1_850_050, 1_850_000]) {
      expect(parsePriceToCents(formatCents(cents))).toBe(cents);
    }
  });
});

describe("generic attributes", () => {
  it("parses key: value lines and keeps colons inside values", () => {
    expect(parseGenericAttributes("months: 24\n\nhours: 9:00-18:00")).toEqual({
      months: "24",
      hours: "9:00-18:00",
    });
  });

  it("rejects a line without a key", () => {
    expect(parseGenericAttributes("just text")).toBeUndefined();
    expect(parseGenericAttributes(": value")).toBeUndefined();
  });

  it("round-trips", () => {
    const attributes = { months: "24", color: "red" };
    expect(parseGenericAttributes(formatGenericAttributes(attributes))).toEqual(attributes);
  });
});

describe("buildCreateInput", () => {
  it("builds a vehicle with typed numbers and without empty optionals", () => {
    const result = buildCreateInput(
      form({
        title: "Toyota Corolla",
        externalId: "",
        price: "18500",
        currency: "usd",
        "attr.make": "Toyota",
        "attr.model": "Corolla",
        "attr.year": "2021",
        "attr.mileageKm": "45000",
        "attr.fuel": "",
      }),
      "vehicle",
    );
    expect(result).toEqual({
      ok: true,
      body: {
        kind: "vehicle",
        title: "Toyota Corolla",
        priceCents: 1_850_000,
        currency: "USD",
        status: "available",
        attributes: { make: "Toyota", model: "Corolla", year: 2021, mileageKm: 45000 },
      },
    });
  });

  it("reports every invalid field by its form name", () => {
    const result = buildCreateInput(
      form({ title: "", price: "12.345", "attr.make": "Toyota", "attr.year": "1800" }),
      "vehicle",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect([...result.errors].sort()).toEqual(
        ["attr.model", "attr.year", "price", "title"].sort(),
      );
    }
  });

  it("requires the property operation and type", () => {
    const result = buildCreateInput(form({ title: "Flat" }), "property");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual(new Set(["attr.operation", "attr.propertyType"]));
    }
  });

  it("builds a generic item from key: value lines", () => {
    const result = buildCreateInput(
      form({ title: "Warranty", genericAttributes: "months: 24" }),
      "generic",
    );
    expect(result.ok && result.body.attributes).toEqual({ months: "24" });
  });

  it("flags malformed generic attributes", () => {
    const result = buildCreateInput(
      form({ title: "Warranty", genericAttributes: "oops" }),
      "generic",
    );
    expect(!result.ok && result.errors.has("genericAttributes")).toBe(true);
  });
});

describe("buildUpdateInput", () => {
  it("sends null for cleared optional fields", () => {
    const result = buildUpdateInput(
      form({
        title: "Flat",
        externalId: "",
        description: "",
        price: "",
        status: "sold",
        "attr.operation": "rent",
        "attr.propertyType": "apartment",
      }),
      { kind: "property" },
    );
    expect(result).toEqual({
      ok: true,
      body: {
        title: "Flat",
        externalId: null,
        description: null,
        priceCents: null,
        currency: "USD",
        status: "sold",
        attributes: { operation: "rent", propertyType: "apartment" },
      },
    });
  });

  it("validates attributes against the item's kind", () => {
    const result = buildUpdateInput(
      form({ title: "Car", status: "available", "attr.make": "Ford", "attr.model": "Ka" }),
      { kind: "vehicle" },
    );
    expect(!result.ok && [...result.errors]).toEqual(["attr.year"]);
  });
});
