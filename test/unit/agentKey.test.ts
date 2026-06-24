// FROZEN GOLDEN — agentKey byte-identity.
//
// Locks the v2:sha256 cache/journal key. These hashes were computed from the live
// monolith's `agentKey` algorithm (`/Users/tom/cmptr/bin/workflow` ~497-503). If
// any of them changes, resume + journal portability silently breaks — treat a
// failure here as a P0 regression, not a snapshot to bless.

import { describe, expect, it } from "bun:test";
import crypto from "node:crypto";
import { agentKey } from "../../src/runtime/agentKey.ts";

// Reference implementation transcribed from the monolith, used to cross-check.
function monolithAgentKey(prompt: string, opts: Record<string, unknown>): string {
  const norm: Record<string, unknown> = {};
  for (const k of ["schema", "label", "phase", "model", "effort", "agentType", "isolation"]) {
    if (opts[k] !== undefined) norm[k] = opts[k];
  }
  return "v2:" + crypto.createHash("sha256").update(JSON.stringify({ prompt, opts: norm })).digest("hex");
}

describe("agentKey (frozen v2:sha256)", () => {
  it("matches locked hash with empty opts", () => {
    expect(agentKey("hello world", {})).toBe(
      "v2:7323203aacc77b005b3d7010a95e3575398acbeae24375d10e8dbe26b217208c",
    );
  });

  it("whitelists only the 7 fields, excludes backend, ignores extras (locked hash)", () => {
    const key = agentKey("framed prompt", {
      label: "x", phase: "P1", model: "m", schema: { type: "object" },
      backend: "codex", IGNORED: "zzz", effort: "high", agentType: "t", isolation: "worktree",
    });
    expect(key).toBe("v2:be36782a597759e905112b80860e8f4aec01afed211aa4e05ec187b85819c4a1");
  });

  it("`backend` does NOT affect the key (cache shared across backends)", () => {
    const base = { label: "a", phase: "p" };
    expect(agentKey("p", { ...base, backend: "claude" })).toBe(agentKey("p", { ...base, backend: "codex" }));
  });

  it("cross-checks the monolith reference impl across varied opts", () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ["", {}],
      ["a", { label: "L" }],
      ["b", { schema: { type: "array", required: ["x", "y"] }, model: "z", effort: "low" }],
      ["c", { isolation: "worktree", agentType: "reviewer", phase: "Gate", backend: "codex", junk: 1 }],
    ];
    for (const [prompt, opts] of cases) {
      expect(agentKey(prompt, opts)).toBe(monolithAgentKey(prompt, opts));
    }
  });
});
