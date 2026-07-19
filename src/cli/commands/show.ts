// `show --json` prints the full workflow row; plain `show` prints key-value
// lines.

import type { Catalog } from "../../types.ts";
import { requireWorkflow } from "../../discovery/resolve.ts";
import { parseOptions } from "../args.ts";

export function show(workflows: Catalog, args: string[]): number {
  const opts = parseOptions(args);
  // Preserve the stable missing-name error from requireWorkflow.
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
