// Journal resume (replay).
//
// Byte-faithful to the monolith's `loadResume` (`/Users/tom/cmptr/bin/workflow`
// ~692-705): read a prior jsonl journal and build the resume cache — ONLY
// `result` events with a non-null `result` and a `key` are replayed (a null
// result was a dead subagent; it must be re-dispatched, not cached). Malformed
// lines are skipped silently.
//
// Phase 3 wires this into `run --resume`; Phase 4 adds the matching writer + the
// frozen journal-shape golden test. No top-level await.

import { existsSync, readFileSync } from "node:fs";

/** Build the resume cache (key -> result) from a prior journal file. Byte-
 * identical to the monolith's `loadResume`. Missing/absent file -> empty cache. */
export function loadResume(file: string | null): Map<string, unknown> {
  const cache = new Map<string, unknown>();
  if (!file || !existsSync(file)) return cache;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === "result" && event.result !== null && event.key) cache.set(event.key, event.result);
    } catch {
      // skip malformed journal lines
    }
  }
  return cache;
}
