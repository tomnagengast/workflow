// `list` command.
//
// Byte-faithful to the monolith's list branch (`/Users/tom/cmptr/bin/workflow`
// ~717-726): `--json` prints the sorted rows (each carrying the raw, un-flattened
// `meta` verbatim — the parity contract) as 2-space JSON; otherwise the colorized
// table. No top-level await.

import type { Catalog } from "../../types.ts";
import { parseOptions } from "../args.ts";
import { printTable } from "../render.ts";

export function list(workflows: Catalog, args: string[]): number {
  const opts = parseOptions(args);
  if (opts.json) {
    const rows = Array.from(workflows.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    console.log(JSON.stringify(rows, null, 2));
  } else {
    printTable(workflows);
  }
  return 0;
}
