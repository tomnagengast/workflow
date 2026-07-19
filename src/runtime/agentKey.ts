// FROZEN MODULE — agentKey (v2:sha256).
//
// The returned key is the cache and journal identity for an agent() or gate()
// dispatch. Resume and journal portability require it to remain byte-stable:
//   - whitelist of opt keys (in this exact order): schema, label, phase, model,
//     effort, agentType, isolation. `backend` is deliberately EXCLUDED.
//   - only present (!== undefined) keys are copied into `norm`.
//   - the hash is sha256 of JSON.stringify({ prompt, opts: norm }), prefixed
//     "v2:". The `prompt` here is the FRAMED prompt (post buildAgent/GatePrompt).
//
// A golden-hash test (agentKey.test.ts) locks these bytes. No top-level await.

import crypto from "node:crypto";

/** Whitelisted option keys in hash order. `backend` is intentionally not
 * here — two backends running the same framed prompt+opts share a cache key. */
const KEY_FIELDS = ["schema", "label", "phase", "model", "effort", "agentType", "isolation"] as const;

/** Compute the v2 cache and journal key for a framed prompt and options. */
export function agentKey(prompt: string, opts: Record<string, unknown>): string {
  const norm: Record<string, unknown> = {};
  for (const k of KEY_FIELDS) {
    if (opts[k] !== undefined) norm[k] = opts[k];
  }
  return "v2:" + crypto.createHash("sha256").update(JSON.stringify({ prompt, opts: norm })).digest("hex");
}
