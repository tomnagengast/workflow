// `validate` command (Phase 6) — read-only loader diagnostic.
//
// Resolves a workflow by NAME (through the discovery catalog) or by explicit
// PATH, runs the real AST validator (loader/validate.ts), and reports whether the
// file satisfies the loader contract: size cap, meta-first, no banned
// non-deterministic constructs. Pure diagnostic — never executes the workflow
// body.
//
// Resolution: a positional that exists as a file on disk, or that looks path-like
// (contains a path separator, or ends in `.js`), is treated as a PATH. Otherwise
// it is a workflow NAME resolved through the catalog (same lookup as `run` /
// `show`, including the "Unknown workflow … Available:" miss). This lets you
// validate both an installed workflow (`workflow validate rpi-agentic`) and a
// file you are authoring (`workflow validate ./my-wf.js`).
//
// Output: plain `ok: <path>` on success; on failure the error message to stderr
// and exit 1. `--json` emits `{ valid, name, path, error? }` to stdout and still
// exits 1 when invalid. No top-level await.

import { readFileSync } from "node:fs";
import path from "node:path";
import type { Catalog } from "../../types.ts";
import { parseOptions } from "../args.ts";
import { requireWorkflow } from "../../discovery/resolve.ts";
import { workflowFilePath } from "../../discovery/target.ts";
import { validateSource } from "../../loader/validate.ts";

/** Resolve the positional to an absolute file path + display name. */
function resolveTarget(workflows: Catalog, target: string): { name: string; path: string } {
  const file = workflowFilePath(target);
  if (file) {
    return { name: path.basename(file, ".js"), path: file };
  }
  const workflow = requireWorkflow(workflows, target);
  return { name: workflow.name, path: workflow.path };
}

export function validate(workflows: Catalog, args: string[]): number {
  const opts = parseOptions(args);
  // Coerce undefined to "undefined" the same way `show`/`run` do, so a missing
  // positional surfaces through the same resolution path rather than a guard.
  const target = opts._[0] as string;
  const resolved = resolveTarget(workflows, target);

  let error: string | null = null;
  try {
    validateSource(readFileSync(resolved.path, "utf8"), resolved.path);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const valid = error === null;

  if (opts.json) {
    console.log(
      JSON.stringify(
        { valid, name: resolved.name, path: resolved.path, ...(error ? { error } : {}) },
        null,
        2,
      ),
    );
  } else if (valid) {
    console.log(`ok: ${resolved.path}`);
  } else {
    console.error(error);
  }

  return valid ? 0 : 1;
}
