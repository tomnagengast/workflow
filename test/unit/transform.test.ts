// FROZEN GOLDEN — source transform byte-identity.
//
// Locks the export-strip + async-IIFE wrap against the live monolith
// (`/Users/tom/cmptr/bin/workflow` ~536-538). The async-IIFE framing is the
// runtime contract (workflows use top-level await); the byte layout must match
// exactly. Treat a failure as a P0 regression.

import { describe, expect, it } from "bun:test";
import { extractMetaObject } from "../../src/loader/meta.ts";
import { transformSource } from "../../src/loader/transform.ts";

describe("transformSource (frozen)", () => {
  it("strips `export` and wraps the body in an async IIFE", () => {
    const src = `export const meta = { name: "x" };\nagent("go");\n`;
    const extracted = extractMetaObject(src)!;
    expect(transformSource(src, extracted)).toBe(
      `(async () => {\nconst meta = { name: "x" };\nagent("go");\n\n})()`,
    );
  });

  it("preserves a leading BOM / comments before the export verbatim", () => {
    const src = `// header\nexport const meta = {a:1};\nx();`;
    const extracted = extractMetaObject(src)!;
    // everything before `export` is kept; only `export const meta` -> `const meta`
    expect(transformSource(src, extracted)).toBe(`(async () => {\n// header\nconst meta = {a:1};\nx();\n})()`);
  });

  it("matches the monolith splice formula exactly", () => {
    const src = `export const meta = {phases:[{title:"P"}]};\nreturn 1;`;
    const extracted = extractMetaObject(src)!;
    const expected = src.slice(0, extracted.start) + "const meta" + src.slice(extracted.start + "export const meta".length);
    expect(transformSource(src, extracted)).toBe(`(async () => {\n${expected}\n})()`);
  });
});
