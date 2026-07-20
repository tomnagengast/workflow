import type { HostActionResult } from "./hostAction.ts";

export type WorkflowStepErrorCode =
  | "backend-unavailable"
  | "backend-failed"
  | "action-invalid"
  | "action-launch-failed"
  | "action-nonzero-exit"
  | "action-timeout"
  | "action-cancelled";

export class WorkflowStepError extends Error {
  readonly code: WorkflowStepErrorCode;
  readonly stepKind: "agent" | "gate" | "action";
  readonly result?: HostActionResult;

  constructor({
    code,
    stepKind,
    message,
    result,
    cause,
  }: {
    code: WorkflowStepErrorCode;
    stepKind: "agent" | "gate" | "action";
    message: string;
    result?: HostActionResult;
    cause?: unknown;
  }) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WorkflowStepError";
    this.code = code;
    this.stepKind = stepKind;
    this.result = result;
  }
}
