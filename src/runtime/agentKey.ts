// FROZEN MODULE — agentKey (v2:sha256).
//
// Byte-faithful to the monolith's `agentKey` (`/Users/tom/cmptr/bin/workflow`
// ~497-503). The returned key is the cache / journal identity for an agent() or
// gate() dispatch; resume and journal portability depend on it being BYTE-STABLE,
// so this MUST stay identical to the monolith forever:
//   - whitelist of opt keys (in this exact order): schema, label, phase, model,
//     effort, agentType, isolation. `backend` is deliberately EXCLUDED.
//   - only present (!== undefined) keys are copied into `norm`.
//   - the hash is sha256 of JSON.stringify({ prompt, opts: norm }), prefixed
//     "v2:". The `prompt` here is the FRAMED prompt (post buildAgent/GatePrompt).
//
// A golden-hash test (agentKey.test.ts) locks these bytes. No top-level await.

import crypto from "node:crypto";

/** The whitelisted opt keys, in monolith order. `backend` is intentionally NOT
 * here — two backends running the same framed prompt+opts share a cache key. */
const KEY_FIELDS = ["schema", "label", "phase", "model", "effort", "agentType", "isolation"] as const;

/** Compute the v2 cache/journal key for a framed prompt + opts. Byte-identical
 * to the monolith. */
export function agentKey(prompt: string, opts: Record<string, unknown>): string {
  const norm: Record<string, unknown> = {};
  for (const k of KEY_FIELDS) {
    if (opts[k] !== undefined) norm[k] = opts[k];
  }
  return "v2:" + crypto.createHash("sha256").update(JSON.stringify({ prompt, opts: norm })).digest("hex");
}
