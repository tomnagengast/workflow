// Meta extraction + evaluation.
//
// Ported verbatim from the monolith (`/Users/tom/cmptr/bin/workflow`
// ~187-216, 245-262): find the `export const meta` object literal by brace
// matching (quote/escape aware), then evaluate it in an EMPTY node:vm context so
// the author's literal (which may use trailing commas, template strings, etc.)
// becomes a real object without executing any workflow body.
//
// `node:vm` works under `bun build --compile --bytecode` (proven in Phase 1).
// Nothing here uses top-level await.

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import vm from "node:vm";
import type { WorkflowRow, WorkflowScope } from "../types.ts";

/** The located meta literal and its source span within the file. */
export interface ExtractedMeta {
  metaSrc: string;
  start: number;
  end: number;
}

/** Locate the `export const meta = { ... }` object literal by brace matching,
 * ignoring braces inside strings/templates. Returns null if absent. Byte-faithful
 * to the monolith's `extractMetaObject`. */
export function extractMetaObject(text: string): ExtractedMeta | null {
  const marker = "export const meta";
  const start = text.indexOf(marker);
  if (start === -1) return null;
  const brace = text.indexOf("{", start);
  if (brace === -1) return null;

  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let i = brace; i < text.length; i += 1) {
    const char = text[i]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return { metaSrc: text.slice(brace, i + 1), start, end: i + 1 };
    }
  }
  return null;
}

/** Evaluate the extracted meta literal in a fresh empty vm context. Mirrors the
 * monolith's `vm.runInContext("(" + metaSrc + ")", emptyContext, { filename })`. */
function evalMeta(metaSrc: string, filePath: string): Record<string, unknown> {
  const context = vm.createContext({});
  return vm.runInContext(`(${metaSrc})`, context, { filename: filePath }) as Record<string, unknown>;
}

/** Parse a workflow file into a discovery row. Byte-faithful to the monolith's
 * `parseWorkflow`: synthesize a default meta when no literal is present, flatten
 * name/description/phases for display, derive `mutating` from a raw whole-file
 * substring scan, and carry the raw evaluated `meta` verbatim. Reads the file
 * synchronously (node:fs), matching the monolith and keeping the discovery path
 * free of any await. */
export function parseWorkflow(filePath: string, scope: WorkflowScope): WorkflowRow {
  return parseWorkflowFromSource(readFileSync(filePath, "utf8"), filePath, scope);
}

/** Same as parseWorkflow but takes already-read source. Used by the catalog,
 * which reads each file once. */
export function parseWorkflowFromSource(
  script: string,
  filePath: string,
  scope: WorkflowScope,
): WorkflowRow {
  const extracted = extractMetaObject(script);
  let meta: Record<string, unknown> = {
    name: basename(filePath, ".js"),
    description: "",
    phases: [],
  };
  if (extracted) {
    meta = evalMeta(extracted.metaSrc, filePath);
  }
  const phasesRaw = meta.phases;
  return {
    name: (meta.name as string) || basename(filePath, ".js"),
    path: filePath,
    scope,
    description: String((meta.description as string) || "").replace(/\s+/g, " "),
    phases: Array.isArray(phasesRaw)
      ? phasesRaw.map((phase) =>
          String((phase as { title?: unknown })?.title ?? phase),
        )
      : [],
    mutating: script.includes("MUTATING"),
    meta,
  };
}
