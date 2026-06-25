// Config layer (Phase 7) — `flags > user > defaults`.
//
// The monolith has NO config file: every run default is hardcoded (backend
// "claude", bins "claude"/"codex", concurrency = defaultConcurrency(), budget
// null, model undefined). Phase 7 adds a single OPTIONAL user layer between
// those baked-in defaults and the per-run flags:
//
//     flags  >  user config  >  defaults
//
// HARD COMPAT INVARIANT: with NO config file present and NO flags passed, the
// resolved values MUST equal the monolith's hardcoded defaults exactly, so a
// stock environment stays byte-identical to today. The config file is purely
// additive — it only moves the *defaults* a `run` falls back to when a flag is
// absent.
//
// Format (Open question 2 → plan default): TOML at
// `~/.config/workflow/config.toml`, parsed with the built-in `Bun.TOML`. Two
// layers only (no per-repo `.workflow.toml` until a real need appears).
//
// No top-level await.

import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { defaultConcurrency } from "../runtime/concurrency.ts";

/** The run-relevant config surface. Every field is optional in the user file;
 * `resolveConfig` fills the gaps from `DEFAULTS`. Keys mirror the run flags
 * (`--backend`, `--model`, `--concurrency`, `--budget`, `--claude-bin`,
 * `--codex-bin`) so config is a 1:1 default for them. */
export interface WorkflowConfig {
  backend: string;
  /** undefined = no model override (matches the monolith's `model` default). */
  model: string | undefined;
  /** Resolved concurrency. The default is environment-derived
   * (defaultConcurrency()); a config value overrides it only when > 0. */
  concurrency: number;
  /** null = no budget ceiling (matches the monolith). */
  budget: number | null;
  claudeBin: string;
  codexBin: string;
}

/** Which layer supplied each resolved field, for `config --print-config`. */
export type ConfigSource = "default" | "user";

export interface ResolvedConfig {
  config: WorkflowConfig;
  /** Per-field provenance: "default" or "user". */
  sources: Record<keyof WorkflowConfig, ConfigSource>;
  /** Absolute path of the user config file, whether or not it exists. */
  path: string;
  /** True when the user config file existed and was read. */
  loaded: boolean;
}

/** The baked-in defaults — byte-identical to the monolith's hardcoded run
 * defaults. `concurrency` is computed per-environment, exactly as the run
 * branch does when `--concurrency` is absent. */
export function defaults(): WorkflowConfig {
  return {
    backend: "claude",
    model: undefined,
    concurrency: defaultConcurrency(),
    budget: null,
    claudeBin: "claude",
    codexBin: "codex",
  };
}

/** Resolve the user config file path. Honors `$XDG_CONFIG_HOME`, falling back
 * to `~/.config` (the XDG default). */
export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.trim() !== ""
    ? env.XDG_CONFIG_HOME
    : path.join(os.homedir(), ".config");
  return path.join(base, "workflow", "config.toml");
}

/** Parse + validate the user TOML into a partial config. Unknown keys are
 * ignored (forward-compat); recognized keys are type-checked and bad values
 * throw a clear error rather than silently corrupting a default. */
function readUserLayer(file: string): Partial<WorkflowConfig> {
  const raw = readFileSync(file, "utf8");
  let parsed: unknown;
  try {
    parsed = Bun.TOML.parse(raw);
  } catch (error) {
    throw new Error(`Invalid config TOML at ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (parsed === null || typeof parsed !== "object") {
    throw new Error(`Invalid config at ${file}: expected a table`);
  }
  const table = parsed as Record<string, unknown>;
  const out: Partial<WorkflowConfig> = {};

  const stringField = (key: "backend" | "model" | "claudeBin" | "codexBin", tomlKey: string): void => {
    if (!(tomlKey in table)) return;
    const value = table[tomlKey];
    if (typeof value !== "string") {
      throw new Error(`Invalid config at ${file}: '${tomlKey}' must be a string`);
    }
    out[key] = value;
  };

  // Accept both snake_case (TOML-idiomatic) and the camelCase flag spellings.
  stringField("backend", "backend");
  stringField("model", "model");
  if ("claude_bin" in table) stringField("claudeBin", "claude_bin");
  if ("claudeBin" in table) stringField("claudeBin", "claudeBin");
  if ("codex_bin" in table) stringField("codexBin", "codex_bin");
  if ("codexBin" in table) stringField("codexBin", "codexBin");

  if ("concurrency" in table) {
    const value = table.concurrency;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
      throw new Error(`Invalid config at ${file}: 'concurrency' must be a positive integer`);
    }
    out.concurrency = value;
  }

  if ("budget" in table) {
    const value = table.budget;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      throw new Error(`Invalid config at ${file}: 'budget' must be a positive number`);
    }
    out.budget = value;
  }

  return out;
}

/** Resolve `defaults → user file` into a single config plus per-field
 * provenance. Flags are applied LATER (in `run`), on top of `config`. When the
 * file is absent the result equals `defaults()` with every source "default" —
 * the byte-compat invariant. */
export function resolveConfig(env: NodeJS.ProcessEnv = process.env): ResolvedConfig {
  const file = configPath(env);
  const base = defaults();
  const sources: Record<keyof WorkflowConfig, ConfigSource> = {
    backend: "default",
    model: "default",
    concurrency: "default",
    budget: "default",
    claudeBin: "default",
    codexBin: "default",
  };

  if (!existsSync(file)) {
    return { config: base, sources, path: file, loaded: false };
  }

  const user = readUserLayer(file);
  const config = { ...base };
  for (const key of Object.keys(user) as (keyof WorkflowConfig)[]) {
    const value = user[key];
    if (value === undefined) continue;
    (config as Record<string, unknown>)[key] = value;
    sources[key] = "user";
  }

  return { config, sources, path: file, loaded: true };
}
