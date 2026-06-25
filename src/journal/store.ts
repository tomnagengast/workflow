// Auto-journal store (Phase 8) — a default-on state dir for run journals.
//
// The monolith journals ONLY when you pass `--journal FILE`; there is no default
// on-disk side effect. Phase 8 adds a minimal auto-journal: every `run` that
// does NOT pass an explicit `--journal` still writes its journal to a per-run
// file under a state dir, and `--resume-last` (or `resume --last`) replays the
// newest one.
//
// BYTE-COMPAT INVARIANT: the auto-journal is a *location*, not a new format. The
// runner writes the same `Journal` (journal/journal.ts) it always has, so the
// on-disk lines carry the exact FROZEN `started`/`result` shapes. That makes
// auto-journals and manual `--journal` files interchangeable: `resume --last`
// reads an auto-journal with the same `loadResume`, and a manual `--journal`
// file can be replayed with `--resume`, and vice-versa.
//
// NO `runs` index/prune subsystem (deferred per the plan): "last" is resolved by
// newest mtime over the journal files in the dir — no manifest, no GC.
//
// No top-level await.

import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** Filename extension for auto-journal files. Plain jsonl. */
const JOURNAL_EXT = ".jsonl";

/** Resolve the auto-journal state directory. Honors `$XDG_STATE_HOME`, falling
 * back to `~/.local/state` (the XDG default) — mirrors config.ts's
 * `$XDG_CONFIG_HOME` handling. Returns `<base>/workflow`. */
export function stateDir(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_STATE_HOME && env.XDG_STATE_HOME.trim() !== ""
    ? env.XDG_STATE_HOME
    : path.join(os.homedir(), ".local", "state");
  return path.join(base, "workflow");
}

/** Compute a fresh, unique auto-journal path for a run and ensure its parent dir
 * exists. The filename encodes the workflow name (sanitized) plus a timestamp +
 * pid so concurrent/back-to-back runs never collide. Returns the absolute path;
 * the file itself is created lazily by the `Journal` write stream. */
export function newJournalPath(
  workflowName: string,
  env: NodeJS.ProcessEnv = process.env,
  now: number = Date.now(),
): string {
  const dir = stateDir(env);
  mkdirSync(dir, { recursive: true });
  const safeName = workflowName.replace(/[^a-zA-Z0-9._-]/g, "-") || "run";
  const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
  const file = `${stamp}-${process.pid}-${safeName}${JOURNAL_EXT}`;
  return path.join(dir, file);
}

/** Resolve the most-recently-modified auto-journal in the state dir, or null if
 * the dir is missing or holds no journals. "Last" = newest mtime (no index/
 * manifest — deferred per plan). Only `*.jsonl` files are considered. */
export function lastJournalPath(env: NodeJS.ProcessEnv = process.env): string | null {
  const dir = stateDir(env);
  if (!existsSync(dir)) return null;
  let best: { file: string; mtimeMs: number } | null = null;
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(JOURNAL_EXT)) continue;
    const full = path.join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue; // raced/removed between readdir and stat
    }
    if (!st.isFile()) continue;
    if (!best || st.mtimeMs > best.mtimeMs) best = { file: full, mtimeMs: st.mtimeMs };
  }
  return best ? best.file : null;
}
