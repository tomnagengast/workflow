// Argument parsing.
//
// Two parsers, both faithful to the monolith (`/Users/tom/cmptr/bin/workflow`):
//
// 1. `parseArgv` (~103-127): the global pre-split. Consumes `-h`/`--help`,
//    `-v`/`--version`, and `--cwd`/`--cwd=`, then the first non-flag token is the
//    command and the rest are its args. (`--version` is a Phase 0 add; the
//    monolith only had help + cwd, but the routing shape is the same.)
//
// 2. `parseOptions` (~129-156): the FROZEN per-command parser. Two load-bearing
//    semantics must stay byte-identical (a golden table lands in Phase 3):
//      - Unknown-flag tolerance: `spec[key] || "boolean"` accepts any unknown
//        `--flag` as boolean, never errors.
//      - Option-like value consumption: `argv[++i]` consumes the next token as
//        the value even if it looks like an option.
//    Do NOT swap in `util.parseArgs` — it breaks both. See the plan's frozen
//    arg-parser note.
//
// No top-level await.

import type { RootInvocation } from "../types.ts";

/** Option spec kinds for `parseOptions`. Unlisted keys default to "boolean". */
export type OptionKind = "boolean" | "string" | "number" | "array";
export type OptionSpec = Record<string, OptionKind>;

/** Parsed option bag: positionals under `_`, flags by camelCase key. */
export interface ParsedOptions {
  _: string[];
  [key: string]: unknown;
}

/** Global pre-split: pull `--help` / `--version` / `--cwd`, then command + args. */
export function parseArgv(argv: string[]): RootInvocation {
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

/** FROZEN per-command option parser. Byte-faithful to the monolith's
 * `parseOptions`. Unknown flags are boolean; option-like values are consumed. */
export function parseOptions(argv: string[], spec: OptionSpec = {}): ParsedOptions {
  const opts: ParsedOptions = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) {
      opts._.push(arg);
      continue;
    }
    const [rawKey, inlineValue] = arg.includes("=")
      ? (arg.split(/=(.*)/s, 2) as [string, string])
      : [arg, undefined];
    const key = rawKey.slice(2).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    const kind: OptionKind = spec[key] || "boolean";
    if (kind === "boolean") {
      opts[key] = true;
      continue;
    }
    const value = inlineValue !== undefined ? inlineValue : argv[++i];
    if (value === undefined) throw new Error(`Missing value for ${rawKey}`);
    if (kind === "array") {
      if (!opts[key]) opts[key] = [];
      (opts[key] as string[]).push(value);
    } else if (kind === "number") {
      opts[key] = Number(value);
    } else {
      opts[key] = value;
    }
  }
  return opts;
}
