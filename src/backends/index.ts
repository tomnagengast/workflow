// Backend registry and read-only PATH preflight. `run` does not preflight PATH;
// it lets spawn errors flow through the normal backend error path.

import type { Backend } from "../types.ts";
import { claudeBackend } from "./claude.ts";
import { codexBackend } from "./codex.ts";

/** Backend name to implementation. */
export const BACKENDS: Record<string, Backend> = {
  claude: claudeBackend,
  codex: codexBackend,
};

/** Resolve a backend binary on PATH (read-only preflight for `doctor`). Returns
 * the resolved absolute path, or null when absent. NOT used by `run`. */
export function backendOnPath(bin: string): string | null {
  return Bun.which(bin);
}
