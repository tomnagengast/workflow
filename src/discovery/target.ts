// Workflow execution target resolution.
//
// Bare names retain the discovery catalog contract. A positional that exists
// as a file or looks path-like resolves to an explicit workflow source instead.
// Relative paths resolve from the invoking process, matching `validate` and
// nested `{ scriptPath }` references; `--cwd` remains the agent working
// directory.

import { existsSync, statSync } from "node:fs";
import path from "node:path";

/** Resolve a path-like target to an existing absolute file path. Returns null
 * when the target is a bare workflow name for catalog resolution. */
export function workflowFilePath(target: unknown): string | null {
  if (typeof target !== "string") return null;
  const looksLikePath =
    target.includes("/") ||
    target.includes(path.sep) ||
    target.endsWith(".js") ||
    (existsSync(target) && statSync(target).isFile());
  if (!looksLikePath) return null;

  const absolute = path.resolve(target);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    throw new Error(`Workflow file not found: ${absolute}`);
  }
  return absolute;
}
