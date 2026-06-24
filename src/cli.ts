#!/usr/bin/env bun
// Workflow CLI entrypoint.
//
// HARD CONSTRAINT (see plan, "--bytecode = CJS"): no top-level await anywhere on
// the load path. All async work runs inside main(); the bottom of this file is a
// plain main().then(...).catch(...) — never `await main()` at module scope.
//
// Phase 0 is a thin stub: it parses the global --cwd / --help / --version flags
// and prints help/version. Real commands (list / show / run / validate / doctor
// / config) land in later phases.

import type { RootInvocation } from "./types.ts";
import { version } from "./version.ts";

const USAGE = `Usage: workflow [--cwd DIR] <command> [options]

Commands:
  list [--json]                         List resolved workflows
  show <name> [--json]                  Show workflow metadata
  run <name> [--args JSON|@file]        Run a workflow against real subagents

Run options:
  --backend claude|codex                Agent backend (default: claude)
  --allow-mutating                      Allow workflows whose meta is marked MUTATING
  --concurrency N                       Max concurrent agent() calls (default: min(16,max(2,cores-2)))
  --budget N                            Token budget for budget.total (default: unlimited)
  --model MODEL                         Model passed to the backend
  --schema-retries N                    Retries when an agent reply fails its schema (default: 2)
  --journal FILE                        Write a started/result journal (jsonl)
  --resume FILE                         Replay cached agent() results from a prior journal
  --no-validate                         Skip the loader validation (size / meta / banned tokens)
  --verbose                             Stream backend logs to stderr

  claude backend:  --claude-bin PATH  --claude-arg ARG (repeatable)  --claude-yolo
  codex backend:   --codex-bin PATH   --codex-arg ARG (repeatable)   --codex-yolo  --sandbox MODE

Examples:
  workflow list
  workflow run adversarial-pr-gate --args '{"diff":"git diff HEAD~1 HEAD"}'
  workflow run plan-review-panel --backend codex --args @args.json`;

function usage(): void {
  console.log(USAGE);
}

/** Mirrors the monolith's parseArgv: consume global --help/--version/--cwd, then
 * the first non-flag token is the command and the rest are its args. */
function parseArgv(argv: string[]): RootInvocation {
  const root: RootInvocation = { cwd: process.cwd(), command: null, args: [] };
  while (argv.length > 0) {
    const arg = argv[0]!;
    if (arg === "-h" || arg === "--help") {
      root.command = "help";
      argv.shift();
      continue;
    }
    if (arg === "-v" || arg === "--version") {
      root.command = "version";
      argv.shift();
      continue;
    }
    if (arg === "--cwd") {
      root.cwd = argv[1] ?? root.cwd;
      argv.splice(0, 2);
      continue;
    }
    if (arg.startsWith("--cwd=")) {
      root.cwd = arg.slice("--cwd=".length);
      argv.shift();
      continue;
    }
    root.command = arg;
    root.args = argv.slice(1);
    break;
  }
  return root;
}

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

  // Commands land in later phases. Until then, route everything else to a clear
  // not-yet-implemented error rather than pretending to run.
  switch (root.command) {
    case "list":
    case "show":
    case "run":
      throw new Error(`Command '${root.command}' is not implemented yet.`);
    default:
      throw new Error(`Unknown command: ${root.command}`);
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
