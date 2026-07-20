// Journal resume replays successful agent, gate, and action results. Runtime,
// workflow, presentation, and failed events remain observations only.

import { existsSync, readFileSync } from "node:fs";

/** Build the resume cache (key -> result) from a prior semantic journal. */
export function loadResume(file: string | null): Map<string, unknown> {
  const cache = new Map<string, unknown>();
  if (!file || !existsSync(file)) return cache;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (
        (event.type === "step.completed" || event.type === "step.cached") &&
        event.kind !== "workflow" &&
        event.key
      ) {
        cache.set(event.key, event.result);
      }
    } catch {
      // skip malformed journal lines
    }
  }
  return cache;
}
