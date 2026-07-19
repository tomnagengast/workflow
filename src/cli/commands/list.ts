// `list --json` prints sorted rows with raw, un-flattened `meta`; plain `list`
// prints the terminal table.

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
