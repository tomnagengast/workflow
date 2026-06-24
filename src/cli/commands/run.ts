// `run` command.
//
// Byte-faithful to the monolith's run branch (`/Users/tom/cmptr/bin/workflow`
// ~743-781) plus `loadArgs` (~286-290): parse the full preserved flag set,
// resolve the workflow, refuse a mutating workflow without --allow-mutating,
// reject an unknown backend, assemble the runtime object, log the one-line
// "[workflow] backend=… concurrency=…" banner to STDERR, run, then print the
// result to STDOUT (raw string, or pretty 2-space JSON for an object).
//
// No top-level await: this returns a Promise the entrypoint awaits inside main().

import { readFileSync } from "node:fs";
import path from "node:path";
import type { Catalog, Runtime } from "../../types.ts";
import { parseOptions, type ParsedOptions } from "../args.ts";
import { requireWorkflow } from "../../discovery/resolve.ts";
import { BACKENDS } from "../../backends/index.ts";
import { loadResume } from "../../journal/resume.ts";
import { newJournalPath, lastJournalPath } from "../../journal/store.ts";
import { WorkflowRunner } from "../../runtime/runner.ts";
import { resolveConfig } from "../../config/config.ts";

const DEFAULT_SCHEMA_RETRIES = 2;

/** Resolve a workflow's `--args JSON|@file` into a value. Byte-identical to the
 * monolith's `loadArgs`. */
function loadArgs(raw: string | undefined): unknown {
  if (raw === undefined) return undefined;
  const text = raw.startsWith("@") ? readFileSync(path.resolve(raw.slice(1)), "utf8") : raw;
  return JSON.parse(text);
}

/** Resolve which journal file to replay for resume. Precedence: an explicit
 * `--resume FILE` (absolutized, exactly as the monolith did) wins; otherwise
 * `--resume-last` resolves the newest auto-journal in the state dir; otherwise
 * no resume (null). */
function resolveResumeFile(opts: ParsedOptions): string | null {
  if (opts.resume) return path.resolve(opts.resume as string);
  if (opts.resumeLast) return lastJournalPath();
  return null;
}

export async function run(workflows: Catalog, cwd: string, args: string[]): Promise<number> {
  const opts = parseOptions(args, {
    args: "string", backend: "string", model: "string", concurrency: "number", budget: "number",
    schemaRetries: "number", journal: "string", resume: "string",
    claudeBin: "string", claudeArg: "array", codexBin: "string", codexArg: "array", sandbox: "string",
  });
  const workflow = requireWorkflow(workflows, opts._[0] as string);
  if (workflow.mutating && !opts.allowMutating) {
    throw new Error(`Refusing to run mutating workflow '${workflow.name}' without --allow-mutating.`);
  }
  // Defaults layer (Phase 7): the resolved user config sits UNDER flags. With
  // no config file, `cfg` equals the monolith's hardcoded defaults, so every
  // `?? cfg.x` below reduces to the old literal — byte-compat preserved.
  const { config: cfg } = resolveConfig();

  const backend = (opts.backend as string) || cfg.backend;
  if (!BACKENDS[backend]) throw new Error(`Unknown backend '${backend}' (expected: claude | codex)`);

  const concurrency = opts.concurrency as number;
  const budget = opts.budget as number;
  const schemaRetries = opts.schemaRetries as number;
  const runtime: Runtime = {
    cwd,
    backend,
    claudeBin: (opts.claudeBin as string) || cfg.claudeBin,
    claudeArgs: (opts.claudeArg as string[]) || [],
    claudeYolo: Boolean(opts.claudeYolo),
    codexBin: (opts.codexBin as string) || cfg.codexBin,
    codexArgs: (opts.codexArg as string[]) || [],
    codexYolo: Boolean(opts.codexYolo),
    sandbox: opts.sandbox as string | undefined,
    model: (opts.model as string | undefined) ?? cfg.model,
    concurrency: Number.isFinite(concurrency) && concurrency > 0 ? concurrency : cfg.concurrency,
    budget: Number.isFinite(budget) && budget > 0 ? budget : cfg.budget,
    schemaRetries: Number.isFinite(schemaRetries) && schemaRetries >= 0 ? schemaRetries : DEFAULT_SCHEMA_RETRIES,
    // Auto-journal (Phase 8): with no explicit `--journal`, every run still
    // journals — to a fresh per-run file in the state dir (~/.local/state/
    // workflow/). The bytes are the FROZEN `started`/`result` shapes (same
    // `Journal` writer), so an auto-journal and a manual `--journal` file are
    // interchangeable. An explicit `--journal FILE` still wins verbatim.
    journalPath: opts.journal ? path.resolve(opts.journal as string) : newJournalPath(workflow.name),
    // Resume cache: explicit `--resume FILE` wins; otherwise `--resume-last`
    // replays the newest auto-journal in the state dir (byte-compatible with
    // manual `--journal` files via the same `loadResume`).
    resumeCache: loadResume(resolveResumeFile(opts)),
    noValidate: Boolean(opts.noValidate),
    verbose: Boolean(opts.verbose),
    vmTimeoutMs: 24 * 60 * 60 * 1000,
  };
  console.error(`[workflow] backend=${backend} concurrency=${runtime.concurrency}${runtime.budget ? ` budget=${runtime.budget}` : ""}`);
  const runner = new WorkflowRunner({ cwd, workflows, runtime });
  const result = await runner.run(workflow, loadArgs(opts.args as string | undefined));
  if (typeof result === "string") console.log(result);
  else console.log(JSON.stringify(result, null, 2));
  return 0;
}
