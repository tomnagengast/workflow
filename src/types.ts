// Shared type skeleton for the workflow runner. Filled in as features land
// across later phases (discovery, loader, runtime, journal). Phase 0 only needs
// the CLI-surface shapes; Phase 2 adds discovery / catalog shapes.

/** Parsed top-level CLI invocation: optional global --cwd, a command, and the
 * remaining args handed to that command's own parser. */
export interface RootInvocation {
  cwd: string;
  command: string | null;
  args: string[];
}

/** Where a discovered workflow came from. `user` = ~/.claude/workflows,
 * `project` = a repo `.claude/workflows`, `scriptPath` = an explicit nested
 * `{ scriptPath }` reference (introduced by the runtime in a later phase). */
export type WorkflowScope = "user" | "project" | "scriptPath";

/** A discovered, meta-parsed workflow row. Matches the monolith's `parseWorkflow`
 * shape byte-for-byte so `list --json` / `show --json` stay parity-identical.
 * `meta` carries the raw evaluated meta literal verbatim (un-flattened), beside
 * the flattened convenience fields. */
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
