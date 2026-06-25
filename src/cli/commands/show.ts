// `show` command.
//
// Byte-faithful to the monolith's show branch (`/Users/tom/cmptr/bin/workflow`
// ~728-741): resolve the named workflow, then `--json` prints the full row
// (raw `meta` included) as 2-space JSON, else the plain key: value lines.
// No top-level await.

import type { Catalog } from "../../types.ts";
import { requireWorkflow } from "../../discovery/resolve.ts";
import { parseOptions } from "../args.ts";

export function show(workflows: Catalog, args: string[]): number {
  const opts = parseOptions(args);
  // The monolith passes `opts._[0]` straight to requireWorkflow even when it is
  // undefined: NAME_RE coerces it to the string "undefined" (which matches), the
  // Map miss then throws "Unknown workflow 'undefined'. Available: …". Preserve
  // that exact behavior by coercing here rather than guarding.
  const name = opts._[0] as string;
  const workflow = requireWorkflow(workflows, name);
  if (opts.json) {
    console.log(JSON.stringify(workflow, null, 2));
  } else {
    console.log(`name: ${workflow.name}`);
    console.log(`scope: ${workflow.scope}`);
    console.log(`path: ${workflow.path}`);
    console.log(`mutating: ${workflow.mutating}`);
    console.log(`phases: ${workflow.phases.join(", ") || "(none)"}`);
    console.log(`description: ${workflow.description}`);
  }
  return 0;
}
