// AST validator unit tests.
//
// Exercises `validateSource` against the good/ and bad/ fixture corpora:
//   - every file under test/fixtures/validate/good/ must validate clean,
//   - every file under test/fixtures/validate/bad/ must throw, with the error
//     message matching the rejection class (meta-first / banned construct /
//     parse error).
//
// These tests pin by-node-type rejections and wrap tolerance for top-level
// return and await.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SOURCE_LIMIT, validateSource } from "../../src/loader/validate.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const GOOD = path.resolve(here, "..", "fixtures", "validate", "good");
const BAD = path.resolve(here, "..", "fixtures", "validate", "bad");

function jsFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".js"))
    .sort();
}

describe("validateSource — good fixtures pass", () => {
  for (const file of jsFiles(GOOD)) {
    test(`good/${file} validates clean`, () => {
      const full = path.join(GOOD, file);
      expect(() => validateSource(readFileSync(full, "utf8"), full)).not.toThrow();
    });
  }
});

describe("validateSource — bad fixtures fail with the right message", () => {
  const expectations: Record<string, RegExp> = {
    "no-meta.js": /first statement must be `export const meta/,
    "meta-not-first.js": /first statement must be `export const meta/,
    "meta-not-literal.js": /first statement must be `export const meta/,
    "date-now.js": /banned non-deterministic construct\(s\): Date\.now\(\) \(would break resume\)/,
    "math-random.js": /banned non-deterministic construct\(s\): Math\.random\(\) \(would break resume\)/,
    "argless-new-date.js":
      /banned non-deterministic construct\(s\): argless new Date\(\) \(would break resume\)/,
    "syntax-error.js": /parse error:/,
  };

  for (const file of jsFiles(BAD)) {
    test(`bad/${file} is rejected`, () => {
      const full = path.join(BAD, file);
      const pattern = expectations[file];
      expect(pattern, `missing expectation for bad/${file}`).toBeDefined();
      expect(() => validateSource(readFileSync(full, "utf8"), full)).toThrow(pattern!);
    });
  }
});

describe("validateSource — specifics", () => {
  test("size cap rejects oversized scripts", () => {
    const huge = `export const meta = { name: "x" };\n` + "a;".repeat(SOURCE_LIMIT);
    expect(() => validateSource(huge, "huge.js")).toThrow(/exceeds 524288 bytes/);
  });

  test("multiple banned constructs are listed in canonical order", () => {
    const src = [
      `export const meta = { name: "multi" };`,
      `const a = Math.random();`,
      `const b = Date.now();`,
      `const c = new Date();`,
    ].join("\n");
    expect(() => validateSource(src, "multi.js")).toThrow(
      /banned non-deterministic construct\(s\): Date\.now\(\), Math\.random\(\), argless new Date\(\)/,
    );
  });

  test("new Date(arg) is allowed; only argless new Date() is banned", () => {
    const ok = `export const meta = { name: "x" };\nconst d = new Date("2020-01-01");`;
    expect(() => validateSource(ok, "ok.js")).not.toThrow();
  });

  test("a computed member like Date['now']() is not flagged (only the literal call shape is banned)", () => {
    // Computed access is a different node shape and is not banned.
    const src = `export const meta = { name: "x" };\nconst f = Date["now"];\nf();`;
    expect(() => validateSource(src, "computed.js")).not.toThrow();
  });
});
