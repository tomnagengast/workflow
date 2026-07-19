import { describe, expect, it } from "bun:test";
import {
  buildHumanGateIdentity,
  buildReviewerGatePrompt,
  gateReviewer,
} from "../../src/runtime/gates.ts";
import type { WorkflowRow } from "../../src/types.ts";

const workflow: WorkflowRow = {
  name: "review",
  path: "/review.js",
  scope: "scriptPath",
  description: "",
  phases: ["Review"],
  mutating: false,
  meta: {},
};

describe("gate reviewers", () => {
  it("keeps agent as the default and accepts pinned or human reviewers", () => {
    expect(gateReviewer(undefined)).toBe("agent");
    expect(gateReviewer("agent")).toBe("agent");
    expect(gateReviewer("codex")).toBe("codex");
    expect(gateReviewer("claude")).toBe("claude");
    expect(gateReviewer("human")).toBe("human");
    expect(() => gateReviewer("robot")).toThrow(
      "gate() reviewer must be 'agent', 'codex', 'claude', or 'human'",
    );
  });

  it("gives pinned and human routes distinct stable prompt identities", () => {
    const input = {
      workflow,
      phaseTitle: "Review",
      prompt: "Approve it?",
      schema: { type: "boolean" },
    };
    expect(buildReviewerGatePrompt({ ...input, backendName: "codex" }))
      .toContain("INDEPENDENT agent gate (running on the codex engine)");
    expect(buildReviewerGatePrompt({ ...input, backendName: "claude" }))
      .toContain("INDEPENDENT agent gate (running on the claude engine)");
    expect(buildHumanGateIdentity(input)).toContain("Human review gate");
    expect(buildHumanGateIdentity({ ...input, schema: undefined }))
      .toContain("Expected response: plain text");
  });
});
