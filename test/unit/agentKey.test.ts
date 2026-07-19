// FROZEN GOLDEN — agentKey byte-identity.
//
// Locks the v2:sha256 cache and journal key. A change breaks resume and journal
// portability, so treat a failure as a P0 regression.

import { describe, expect, it } from "bun:test";
import { agentKey } from "../../src/runtime/agentKey.ts";

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

  it("locks hashes across varied optional fields", () => {
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ["", {}, "v2:5970e2adaade7045f993df0c46c5e7a038edf033a4885994d85a68421d038e6d"],
      ["a", { label: "L" }, "v2:89147b236174254202c02392491231d516f391f98af1a144f67a3747e1de1842"],
      [
        "b",
        { schema: { type: "array", required: ["x", "y"] }, model: "z", effort: "low" },
        "v2:1381a23091cfc4c6615a0b1988da2c3608579e0834a5cb55f50b97431453f5d7",
      ],
      [
        "c",
        { isolation: "worktree", agentType: "reviewer", phase: "Gate", backend: "codex", junk: 1 },
        "v2:b91629b232fb14ac1ec9bbde1bd5af0368ed6acb6f03ee1df1681cb72c3ee313",
      ],
    ];
    for (const [prompt, opts, expected] of cases) {
      expect(agentKey(prompt, opts)).toBe(expected);
    }
  });
});
