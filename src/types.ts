// Shared types for the workflow CLI and runtime.

/** Parsed top-level CLI invocation: optional global --cwd, a command, and the
 * remaining args handed to that command's own parser. */
export interface RootInvocation {
  cwd: string;
  command: string | null;
  args: string[];
}

/** Where a workflow came from. `user` = ~/.claude/workflows, `project` = a
 * repo `.claude/workflows`, `scriptPath` = an explicit CLI file target or
 * nested `{ scriptPath }` reference. */
export type WorkflowScope = "user" | "project" | "scriptPath";

/** A discovered, meta-parsed workflow row. `meta` carries the raw evaluated
 * literal beside the flattened convenience fields. */
export interface WorkflowRow {
  name: string;
  path: string;
  scope: WorkflowScope;
  description: string;
  phases: string[];
  mutating: boolean;
  // The raw, un-flattened meta object exactly as the script's literal evaluated
  // to (or the synthesized default when no `export const meta` is present). Its
  // shape is author-defined, so it stays `unknown`-keyed.
  meta: Record<string, unknown>;
}

/** The discovered catalog: workflow name -> row, later scopes shadowing earlier. */
export type Catalog = Map<string, WorkflowRow>;

/** Resolved run-time configuration assembled by `cli/commands/run.ts`. */
export interface Runtime {
  cwd: string;
  backend: string;
  claudeBin: string;
  claudeArgs: string[];
  claudeYolo: boolean;
  codexBin: string;
  codexArgs: string[];
  codexYolo: boolean;
  sandbox: string | undefined;
  /** Model for the selected backend. Opposite-backend gates use their default. */
  model: string | undefined;
  concurrency: number;
  budget: number | null;
  schemaRetries: number;
  journalPath: string | null;
  resumeCache: Map<string, unknown>;
  noValidate: boolean;
  verbose: boolean;
  vmTimeoutMs: number;
  signal?: AbortSignal;
}

/** A backend's return envelope: the agent's value (text or schema-parsed object)
 * plus the token count to charge against the budget. */
export interface BackendResult {
  value: unknown;
  tokens: number;
}

/** A backend implementation: frame -> { value, tokens }. */
export type Backend = (prompt: string, schema: unknown, rt: Runtime) => Promise<BackendResult>;
