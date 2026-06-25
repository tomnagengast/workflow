// `config` command (Phase 7) — inspect the resolved config layers.
//
// Read-only. `config --print-config` resolves `defaults → user file` and prints
// each field with its provenance ("default" or "user"), plus the config file
// path and whether it was loaded. `--json` emits the structured ResolvedConfig.
//
// Flags are NOT applied here: this shows the *defaults* a `run` falls back to,
// i.e. the bottom of the `flags > user > defaults` stack. No top-level await.

import { parseOptions } from "../args.ts";
import { resolveConfig, type ResolvedConfig, type WorkflowConfig } from "../../config/config.ts";

/** Render a config value for the human view (undefined/null shown explicitly). */
function display(value: unknown): string {
  if (value === undefined) return "(none)";
  if (value === null) return "(none)";
  return String(value);
}

const FIELD_ORDER: (keyof WorkflowConfig)[] = [
  "backend",
  "model",
  "concurrency",
  "budget",
  "claudeBin",
  "codexBin",
];

export function printConfig(resolved: ResolvedConfig): void {
  console.log(`config file: ${resolved.path}${resolved.loaded ? "" : " (not present)"}`);
  console.log("");
  console.log("resolved (defaults < user; flags apply at run time):");
  for (const key of FIELD_ORDER) {
    const value = resolved.config[key];
    const source = resolved.sources[key];
    console.log(`  ${key} = ${display(value)}  [${source}]`);
  }
}

export function config(args: string[]): number {
  const opts = parseOptions(args);
  const resolved = resolveConfig();

  if (opts.json) {
    console.log(JSON.stringify(resolved, null, 2));
    return 0;
  }

  // `--print-config` is the documented entry; with no subflag we still print
  // (there is nothing else `config` does yet), so the command is always useful.
  printConfig(resolved);
  return 0;
}
