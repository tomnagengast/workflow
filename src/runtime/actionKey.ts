import crypto from "node:crypto";
import type { NormalizedHostActionSpec } from "./hostAction.ts";

export function actionIdentity({
  workflowPath,
  spec,
}: {
  workflowPath: string;
  spec: NormalizedHostActionSpec;
}): string {
  const identity = JSON.stringify({
    workflowPath,
    executable: spec.executable,
    arguments: spec.arguments,
    cwd: spec.cwd,
    stdin: spec.stdin,
    timeoutMs: spec.timeoutMs,
  });
  return crypto.createHash("sha256").update(identity).digest("hex");
}

export function actionKey(identity: string, occurrence: number): string {
  return `action:v1:${identity}:${occurrence}`;
}
