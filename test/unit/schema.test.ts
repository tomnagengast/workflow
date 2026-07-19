// Structured-output helpers: fence-aware JSON extraction with
// trailing-junk trimming, and the light top-level type + required-keys check that
// drives the claude schema-retry loop.

import { describe, expect, it } from "bun:test";
import { tryParseJson, schemaOk } from "../../src/schema/validate.ts";

describe("tryParseJson", () => {
  it("extracts JSON from a ```json fenced block", () => {
    expect(tryParseJson('prose\n```json\n{"a":1}\n```\nmore')).toEqual({ a: 1 });
  });

  it("extracts a bare object, trimming trailing junk", () => {
    expect(tryParseJson('here: {"k":[1,2]} trailing nonsense')).toEqual({ k: [1, 2] });
  });

  it("prefers an array when [ comes before {", () => {
    expect(tryParseJson("result [1,2,3] then {ignored}")).toEqual([1, 2, 3]);
  });

  it("returns null when there is no JSON value", () => {
    expect(tryParseJson("no braces here")).toBeNull();
  });
});

describe("schemaOk", () => {
  it("returns true for an absent / non-object schema", () => {
    expect(schemaOk({ anything: true }, null)).toBe(true);
    expect(schemaOk(42, "nope")).toBe(true);
  });

  it("enforces top-level object type", () => {
    expect(schemaOk({ a: 1 }, { type: "object" })).toBe(true);
    expect(schemaOk([1], { type: "object" })).toBe(false);
    expect(schemaOk(null, { type: "object" })).toBe(false);
  });

  it("enforces top-level array type", () => {
    expect(schemaOk([1], { type: "array" })).toBe(true);
    expect(schemaOk({ a: 1 }, { type: "array" })).toBe(false);
  });

  it("enforces required keys", () => {
    expect(schemaOk({ a: 1, b: 2 }, { type: "object", required: ["a", "b"] })).toBe(true);
    expect(schemaOk({ a: 1 }, { type: "object", required: ["a", "b"] })).toBe(false);
  });
});
