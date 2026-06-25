// Workflow discovery + catalog.
//
// Byte-faithful to the monolith's `repoRoot` / `workflowDirs` / `catalog`
// (`/Users/tom/cmptr/bin/workflow` ~158-274): resolve the git repo root, walk
// from cwd up to it collecting `.claude/workflows` dirs, plus the user-level
// `~/.claude/workflows`, then load every `.js` file in sorted order. Later scopes
// SHADOW earlier ones because they overwrite the same Map key (user first, then
// project dirs root->cwd), so the nearest project workflow wins.
//
// `Bun.spawnSync` replaces node's `child_process.spawnSync` for the git call
// (the plan calls for Bun.spawnSync git); the discovery contract is otherwise
// identical. No top-level await.

import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { Catalog, WorkflowScope } from "../types.ts";
import { parseWorkflow } from "../loader/meta.ts";

/** Resolve the git repo root for `cwd`, or null when not inside a repo.
 * Mirrors the monolith: `git rev-parse --show-toplevel`, stderr ignored,
 * non-zero status -> null. */
export function repoRoot(cwd: string): string | null {
  const result = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], {
    cwd,
    stdout: "pipe",
    stderr: "ignore",
    stdin: "ignore",
  });
  if (result.exitCode !== 0) return null;
  return path.resolve(result.stdout.toString().trim());
}

/** Ordered list of [scope, dir] discovery roots for `cwd`. User-level first,
 * then each project `.claude/workflows` from repo root down to cwd. Byte-faithful
 * to the monolith's `workflowDirs`. */
export function workflowDirs(cwd: string): Array<[WorkflowScope, string]> {
  const dirs: Array<[WorkflowScope, string]> = [];
  const homeDir = path.join(homedir(), ".claude", "workflows");
  if (existsSync(homeDir)) dirs.push(["user", homeDir]);

  const root = repoRoot(cwd) || cwd;
  let current = path.resolve(cwd);
  const chain = [current];
  while (current !== root && path.dirname(current) !== current) {
    current = path.dirname(current);
    chain.push(current);
  }
  for (const base of chain.reverse()) {
    const projectDir = path.join(base, ".claude", "workflows");
    if (existsSync(projectDir)) dirs.push(["project", projectDir]);
  }
  return dirs;
}

/** Build the discovery catalog for `cwd`: a Map keyed by workflow name with
 * later scopes shadowing earlier (same insertion semantics as the monolith).
 * Entries are sorted within each dir by filename. */
export function catalog(cwd: string): Catalog {
  const workflows: Catalog = new Map();
  for (const [scope, dir] of workflowDirs(cwd)) {
    for (const entry of readdirSync(dir).sort()) {
      if (!entry.endsWith(".js")) continue;
      const workflow = parseWorkflow(path.join(dir, entry), scope);
      workflows.set(workflow.name, workflow);
    }
  }
  return workflows;
}
