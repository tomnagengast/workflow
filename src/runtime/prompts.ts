// FROZEN MODULE — prompt framing + GATE_SCHEMA + opposite().
//
// Byte-faithful to the monolith (`/Users/tom/cmptr/bin/workflow` ~449-495,
// ~466-468). These strings feed agentKey() (the framed prompt is what gets
// hashed), so any change here silently invalidates every cached/journaled result
// and breaks resume. They MUST stay byte-identical:
//   - buildAgentPrompt header lines + the schema footer (exact wording/newlines).
//   - buildGatePrompt lines (exact wording/newlines).
//   - GATE_SCHEMA (default cross-model verdict schema).
//   - opposite() (claude<->codex).
//
// A golden-string test (prompts.test.ts) locks these bytes. No top-level await.

import type { WorkflowRow } from "../types.ts";

/** Build the framed prompt handed to an agent() backend. Byte-identical to the
 * monolith's `buildAgentPrompt`: header lines (dropping falsy ones via
 * `.filter(Boolean)`), then an optional JSON-schema footer. */
export function buildAgentPrompt({
  workflow,
  phaseTitle,
  label,
  prompt,
  schema,
}: {
  workflow: WorkflowRow;
  phaseTitle?: string;
  label?: string;
  prompt: string;
  schema?: unknown;
}): string {
  const header = [
    `You are a subagent running inside workflow "${workflow.name}".`,
    phaseTitle ? `Current workflow phase: ${phaseTitle}.` : "",
    label ? `Agent label: ${label}.` : "",
    "Complete only the task below. Treat it as self-contained unless it asks you to inspect the repository.",
    "",
    "TASK:",
    prompt,
  ].filter(Boolean).join("\n");
  if (!schema) return header;
  return `${header}

Return only JSON matching this schema. No prose, no markdown fences:
${JSON.stringify(schema)}`;
}

/** Return the opposite backend name. Byte-identical to the monolith. */
export function opposite(backend: string): string {
  return backend === "claude" ? "codex" : "claude";
}

/** Default verdict schema for a cross-model gate(); workflows may pass their own.
 * Byte-identical to the monolith's `GATE_SCHEMA`. */
export const GATE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["approved", "blockers", "decision", "rationale"],
  properties: {
    approved: { type: "boolean", description: "true only if the artifact may proceed as-is" },
    blockers: { type: "array", items: { type: "string" }, description: "what must change before approval (empty if approved)" },
    decision: { type: "string", description: "for an intent gate: the option you chose on the human's behalf; else empty" },
    rationale: { type: "string" },
  },
} as const;

/** Build the framed prompt handed to the cross-model gate() backend.
 * Byte-identical to the monolith's `buildGatePrompt`. */
export function buildGatePrompt({
  workflow,
  backendName,
  phaseTitle,
  prompt,
  schema,
}: {
  workflow: WorkflowRow;
  backendName: string;
  phaseTitle?: string;
  prompt: string;
  schema: unknown;
}): string {
  return [
    `You are an INDEPENDENT cross-model gate (running on the ${backendName} engine) for workflow "${workflow.name}".`,
    `You did NOT produce the artifact under review. Judge it on its merits; do not rubber-stamp, and do not be needlessly contrarian.`,
    phaseTitle ? `Workflow phase: ${phaseTitle}.` : "",
    "",
    "GATE TASK:",
    prompt,
    "",
    "Return only JSON matching this schema. No prose, no markdown fences:",
    JSON.stringify(schema),
  ].filter(Boolean).join("\n");
}
