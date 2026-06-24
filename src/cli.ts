#!/usr/bin/env bun
// Workflow CLI entrypoint.
//
// HARD CONSTRAINT (see plan, "--bytecode = CJS"): no top-level await anywhere on
// the load path. All async work runs inside main(); the bottom of this file is a
// plain main().then(...).catch(...) — never `await main()` at module scope.
//
// Phase 2 wires real read-only commands: `list` and `show` run against the actual
// discovery roots (`~/.claude/workflows` + project `.claude/workflows`). `run`
// lands in Phase 3.

import { parseArgv } from "./cli/args.ts";
import { list } from "./cli/commands/list.ts";
import { show } from "./cli/commands/show.ts";
import { usage } from "./cli/help.ts";
import { catalog } from "./discovery/catalog.ts";
import { version } from "./version.ts";
import { resolve } from "node:path";

async function main(): Promise<number> {
  const root = parseArgv(process.argv.slice(2));

  if (!root.command || root.command === "help") {
    usage();
    return 0;
  }

  if (root.command === "version") {
    console.log(version);
    return 0;
  }

  const cwd = resolve(root.cwd);

  if (root.command === "list") {
    return list(catalog(cwd), root.args);
  }

  if (root.command === "show") {
    return show(catalog(cwd), root.args);
  }

  if (root.command === "run") {
    // Runtime lands in Phase 3.
    throw new Error(`Command 'run' is not implemented yet.`);
  }

  throw new Error(`Unknown command: ${root.command}`);
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
