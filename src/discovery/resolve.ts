// Workflow name resolution.
//
// Byte-faithful to the monolith's `NAME_RE` + `requireWorkflow`
// (`/Users/tom/cmptr/bin/workflow` ~35, ~276-284): validate the requested name
// against the allowed character set, then look it up in the catalog, throwing a
// sorted "Available: …" list on a miss. No top-level await.

import type { Catalog, WorkflowRow } from "../types.ts";

/** Allowed workflow name pattern (must start alphanumeric, then [A-Za-z0-9._-]). */
export const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

/** Look up `name` in the catalog. Throws "Invalid workflow name" for a malformed
 * name, or "Unknown workflow '…'. Available: …" (sorted) when absent. */
export function requireWorkflow(workflows: Catalog, name: string): WorkflowRow {
  if (!NAME_RE.test(name)) throw new Error(`Invalid workflow name: ${name}`);
  const workflow = workflows.get(name);
  if (!workflow) {
    const available = Array.from(workflows.keys()).sort().join(", ") || "none";
    throw new Error(`Unknown workflow '${name}'. Available: ${available}`);
  }
  return workflow;
}
