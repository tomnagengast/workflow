// FROZEN GOLDEN — prompt framing + GATE_SCHEMA byte-identity.
//
// The framed prompt is what agentKey() hashes, so drift invalidates cached and
// journaled results. Treat a failure as a P0 regression.

import { describe, expect, it } from "bun:test";
import { buildAgentPrompt, buildGatePrompt, GATE_SCHEMA, opposite } from "../../src/runtime/prompts.ts";
import type { WorkflowRow } from "../../src/types.ts";

const wf = { name: "wf" } as WorkflowRow;

describe("buildAgentPrompt (frozen)", () => {
  it("frames with phase + label, no schema (filter(Boolean) drops the blank line)", () => {
    expect(buildAgentPrompt({ workflow: wf, phaseTitle: "P1", label: "agent", prompt: "do x" })).toBe(
      'You are a subagent running inside workflow "wf".\n' +
        "Current workflow phase: P1.\n" +
        "Agent label: agent.\n" +
        "Complete only the task below. Treat it as self-contained unless it asks you to inspect the repository.\n" +
        "TASK:\n" +
        "do x",
    );
  });

  it("frames with schema footer when a schema is present", () => {
    expect(
      buildAgentPrompt({ workflow: wf, phaseTitle: "", label: "", prompt: "do y", schema: { type: "object", required: ["k"] } }),
    ).toBe(
      'You are a subagent running inside workflow "wf".\n' +
        "Complete only the task below. Treat it as self-contained unless it asks you to inspect the repository.\n" +
        "TASK:\n" +
        "do y\n\n" +
        "Return only JSON matching this schema. No prose, no markdown fences:\n" +
        '{"type":"object","required":["k"]}',
    );
  });
});

describe("buildGatePrompt (frozen)", () => {
  it("frames the cross-model gate with engine name + schema footer (filter(Boolean) drops the blank separators)", () => {
    expect(
      buildGatePrompt({ workflow: wf, backendName: "codex", phaseTitle: "Gate", prompt: "approve?", schema: GATE_SCHEMA }),
    ).toBe(
      'You are an INDEPENDENT cross-model gate (running on the codex engine) for workflow "wf".\n' +
        "You did NOT produce the artifact under review. Judge it on its merits; do not rubber-stamp, and do not be needlessly contrarian.\n" +
        "Workflow phase: Gate.\n" +
        "GATE TASK:\n" +
        "approve?\n" +
        "Return only JSON matching this schema. No prose, no markdown fences:\n" +
        JSON.stringify(GATE_SCHEMA),
    );
  });
});

describe("GATE_SCHEMA + opposite (frozen)", () => {
  it("GATE_SCHEMA serializes to the locked bytes", () => {
    expect(JSON.stringify(GATE_SCHEMA)).toBe(
      '{"type":"object","additionalProperties":false,"required":["approved","blockers","decision","rationale"],' +
        '"properties":{"approved":{"type":"boolean","description":"true only if the artifact may proceed as-is"},' +
        '"blockers":{"type":"array","items":{"type":"string"},"description":"what must change before approval (empty if approved)"},' +
        '"decision":{"type":"string","description":"for an intent gate: the option you chose on the human\'s behalf; else empty"},' +
        '"rationale":{"type":"string"}}}',
    );
  });

  it("opposite() flips claude<->codex", () => {
    expect(opposite("claude")).toBe("codex");
    expect(opposite("codex")).toBe("claude");
  });
});
