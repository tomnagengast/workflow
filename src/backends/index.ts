// Backend registry + PATH preflight.
//
// `BACKENDS` mirrors the monolith's `BACKENDS = { claude, codex }` map
// (`/Users/tom/cmptr/bin/workflow` ~447). The runner looks a backend up by name;
// an unknown name resolves to undefined and the dispatch path logs "backend
// unavailable -> null" exactly as the monolith does.
//
// `backendOnPath` is a READ-ONLY preflight helper for `doctor` (Phase 6) — it is
// deliberately NOT wired into the run dispatch path. The monolith does not
// preflight PATH; it spawns and lets `child.error` throw. Wiring a preflight into
// `run` would change its error surface and break Phase 5 characterization parity,
// so this stays a standalone helper. No top-level await.

import type { Backend } from "../types.ts";
import { claudeBackend } from "./claude.ts";
import { codexBackend } from "./codex.ts";

/** Backend name -> implementation. Byte-identical to the monolith's `BACKENDS`. */
export const BACKENDS: Record<string, Backend> = {
  claude: claudeBackend,
  codex: codexBackend,
};

/** Resolve a backend binary on PATH (read-only preflight for `doctor`). Returns
 * the resolved absolute path, or null when absent. NOT used by `run`. */
export function backendOnPath(bin: string): string | null {
  return Bun.which(bin);
}
