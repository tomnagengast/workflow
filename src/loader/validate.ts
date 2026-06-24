// Loader validation.
//
// Ported verbatim from the monolith's `validateSource`
// (`/Users/tom/cmptr/bin/workflow` ~221-243): a regex heuristic of the binary's
// acorn-based loader checks — size cap, meta-first statement, and the three
// banned non-deterministic constructs. Strips string/comment content before the
// banned-token scan to avoid false positives.
//
// This is the "minimal meta-presence" starting point per the Phase 2 plan; Phase
// 6 replaces the banned-token heuristic with a real AST walk (`accept-set ⊇`
// snapshot). `list` / `show` do not call this (read-only); `run` (Phase 3) will.
// No top-level await.

/** 512 KiB source cap (`_$` in the original binary). */
export const SOURCE_LIMIT = 524288;

/** Throw a descriptive Error if the script violates the loader contract: too
 * large, not meta-first, or contains a banned non-deterministic construct. */
export function validateSource(script: string, filePath: string): void {
  if (Buffer.byteLength(script, "utf8") > SOURCE_LIMIT) {
    throw new Error(`Workflow ${filePath} exceeds ${SOURCE_LIMIT} bytes`);
  }
  const firstCode = script
    .replace(/^﻿/, "")
    .replace(/^(\s*\/\/[^\n]*\n|\s*\/\*[\s\S]*?\*\/|\s+)*/, "");
  if (!/^export\s+const\s+meta\s*=/.test(firstCode)) {
    throw new Error(
      `Workflow ${filePath}: first statement must be \`export const meta = { ... }\``,
    );
  }
  // crude de-string/de-comment for the banned-token scan
  const scrubbed = script
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/`(?:\\.|[^`\\])*`/g, "``")
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""');
  const banned: string[] = [];
  if (/\bDate\s*\.\s*now\b/.test(scrubbed)) banned.push("Date.now()");
  if (/\bMath\s*\.\s*random\b/.test(scrubbed)) banned.push("Math.random()");
  if (/\bnew\s+Date\s*\(\s*\)/.test(scrubbed)) banned.push("argless new Date()");
  if (banned.length) {
    throw new Error(
      `Workflow ${filePath}: banned non-deterministic construct(s): ${banned.join(", ")} (would break resume)`,
    );
  }
}
