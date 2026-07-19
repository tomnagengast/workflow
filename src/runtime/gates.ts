import type { WorkflowRow } from "../types.ts";

export type GateReviewer = "agent" | "codex" | "claude" | "human";

export interface HumanGateRequest {
  workflow: string;
  phase: string;
  stepId: number;
  key: string;
  agentId: string;
  prompt: string;
  schema?: unknown;
}

export class HumanGateSuspended extends Error {
  constructor(readonly request: HumanGateRequest) {
    super(`human review required: ${request.prompt}`);
    this.name = "HumanGateSuspended";
  }
}

export function gateReviewer(value: unknown): GateReviewer {
  if (value === undefined || value === "agent") return "agent";
  if (value === "codex" || value === "claude" || value === "human") return value;
  throw new Error("gate() reviewer must be 'agent', 'codex', 'claude', or 'human'");
}

export function buildReviewerGatePrompt({
  workflow,
  backendName,
  phaseTitle,
  prompt,
  schema,
}: {
  workflow: WorkflowRow;
  backendName: "codex" | "claude";
  phaseTitle?: string;
  prompt: string;
  schema: unknown;
}): string {
  return [
    `You are an INDEPENDENT agent gate (running on the ${backendName} engine) for workflow "${workflow.name}".`,
    "Judge the artifact on its merits; do not rubber-stamp, and do not be needlessly contrarian.",
    phaseTitle ? `Workflow phase: ${phaseTitle}.` : "",
    "",
    "GATE TASK:",
    prompt,
    "",
    "Return only JSON matching this schema. No prose, no markdown fences:",
    JSON.stringify(schema),
  ].filter(Boolean).join("\n");
}

export function buildHumanGateIdentity({
  workflow,
  phaseTitle,
  prompt,
  schema,
}: {
  workflow: WorkflowRow;
  phaseTitle?: string;
  prompt: string;
  schema?: unknown;
}): string {
  return [
    `Human review gate for workflow "${workflow.name}".`,
    phaseTitle ? `Workflow phase: ${phaseTitle}.` : "",
    "",
    "GATE TASK:",
    prompt,
    "",
    schema ? "Expected response schema:" : "Expected response: plain text",
    schema ? JSON.stringify(schema) : "",
  ].filter(Boolean).join("\n");
}
