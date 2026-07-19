// FROZEN MODULE — source transform (export-strip + async-IIFE wrap).
//
// This transform turns workflow source into something `vm.runInContext` can
// execute:
//   1. drop the leading `export` keyword so `export const meta = {...}` becomes a
//      plain `const meta = {...}` declaration in the body. This is done by string
//      splice at `extracted.start`, replacing exactly the `export const meta`
//      token with `const meta` (preserving everything before/after byte-for-byte).
//   2. wrap the whole transformed body in `(async () => {\n…\n})()` so top-level
//      `await` inside the workflow is legal and the IIFE's promise is the result.
//
// The async-IIFE framing is part of the runtime contract (workflows rely on
// top-level await). A golden test (transform.test.ts) locks these bytes. No top-
// level await here.

import type { ExtractedMeta } from "./meta.ts";

const EXPORT_META = "export const meta";

/** Strip the leading `export` from the meta declaration and wrap the body in an
 * async IIFE. `extracted` must come from `extractMetaObject(script)`. */
export function transformSource(script: string, extracted: ExtractedMeta): string {
  // drop the `export` keyword so `const meta = {...}` stays a normal declaration
  const transformed = script.slice(0, extracted.start) + "const meta" + script.slice(extracted.start + EXPORT_META.length);
  return `(async () => {\n${transformed}\n})()`;
}
