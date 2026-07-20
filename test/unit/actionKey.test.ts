import { describe, expect, it } from "bun:test";
import { actionIdentity, actionKey } from "../../src/runtime/actionKey.ts";

const spec = {
  executable: "/usr/bin/git",
  arguments: ["status", "--short"],
  cwd: "/tmp/project",
  timeoutMs: 1000,
};

describe("action cache identity", () => {
  it("is stable for the same workflow and normalized spec", () => {
    const first = actionIdentity({ workflowPath: "/tmp/workflow.js", spec });
    const second = actionIdentity({ workflowPath: "/tmp/workflow.js", spec: { ...spec } });
    expect(first).toBe(second);
    expect(actionKey(first, 1)).toBe(actionKey(second, 1));
  });

  it("separates repeated identical actions without coupling different specs", () => {
    const identity = actionIdentity({ workflowPath: "/tmp/workflow.js", spec });
    const other = actionIdentity({
      workflowPath: "/tmp/workflow.js",
      spec: { ...spec, arguments: ["diff", "--check"] },
    });
    expect(actionKey(identity, 1)).not.toBe(actionKey(identity, 2));
    expect(actionKey(identity, 1)).not.toBe(actionKey(other, 1));
  });
});
