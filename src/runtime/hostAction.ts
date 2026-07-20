import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { WorkflowStepError } from "./failures.ts";
import { BoundedOutput, failureContext } from "./output.ts";

export const MAX_ACTION_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const FORCE_KILL_AFTER_MS = 1000;

export interface HostActionSpec {
  executable: string;
  arguments: string[];
  cwd?: string;
  stdin?: string;
  timeoutMs: number;
}

export interface NormalizedHostActionSpec {
  executable: string;
  arguments: string[];
  cwd: string;
  stdin?: string;
  timeoutMs: number;
}

export interface HostActionResult {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  stdoutBytes: number;
  stderrBytes: number;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  timedOut: boolean;
  cancelled: boolean;
}

function invalid(message: string): WorkflowStepError {
  return new WorkflowStepError({
    code: "action-invalid",
    stepKind: "action",
    message: `invalid action: ${message}`,
  });
}

export function normalizeHostActionSpec(
  value: unknown,
  defaultCwd: string,
): NormalizedHostActionSpec {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalid("expected an object");
  }
  const spec = value as Record<string, unknown>;
  if (typeof spec.executable !== "string" || spec.executable.length === 0) {
    throw invalid("executable must be a non-empty string");
  }
  if (!Array.isArray(spec.arguments) || spec.arguments.some((argument) => typeof argument !== "string")) {
    throw invalid("arguments must be an array of strings");
  }
  if (spec.cwd !== undefined && (typeof spec.cwd !== "string" || spec.cwd.length === 0)) {
    throw invalid("cwd must be a non-empty string when provided");
  }
  if (spec.stdin !== undefined && typeof spec.stdin !== "string") {
    throw invalid("stdin must be a string when provided");
  }
  if (
    !Number.isSafeInteger(spec.timeoutMs) ||
    Number(spec.timeoutMs) <= 0 ||
    Number(spec.timeoutMs) > MAX_ACTION_TIMEOUT_MS
  ) {
    throw invalid(`timeoutMs must be an integer from 1 to ${MAX_ACTION_TIMEOUT_MS}`);
  }
  return {
    executable: spec.executable,
    arguments: [...spec.arguments] as string[],
    cwd: spec.cwd === undefined ? defaultCwd : path.resolve(defaultCwd, spec.cwd),
    stdin: spec.stdin as string | undefined,
    timeoutMs: Number(spec.timeoutMs),
  };
}

function terminate(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid == null) return;
  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // The child may have exited or failed to become a process-group leader.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // The close or error event will settle the action.
  }
}

export function runHostAction(
  spec: NormalizedHostActionSpec,
  signal?: AbortSignal,
): Promise<HostActionResult> {
  return new Promise((resolve, reject) => {
    const stdout = new BoundedOutput();
    const stderr = new BoundedOutput();
    let child: ChildProcess;
    let settled = false;
    let timedOut = false;
    let cancelled = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;

    const result = (
      status: number | null,
      exitSignal: NodeJS.Signals | null,
    ): HostActionResult => {
      const out = stdout.value();
      const err = stderr.value();
      return {
        status,
        signal: exitSignal,
        stdout: out.text,
        stderr: err.text,
        stdoutBytes: out.bytes,
        stderrBytes: err.bytes,
        stdoutTruncated: out.truncated,
        stderrTruncated: err.truncated,
        timedOut,
        cancelled,
      };
    };

    const cleanup = () => {
      clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      signal?.removeEventListener("abort", onAbort);
    };

    const fail = (
      code: "action-launch-failed" | "action-nonzero-exit" | "action-timeout" | "action-cancelled",
      message: string,
      actionResult: HostActionResult,
      cause?: unknown,
    ) => {
      reject(new WorkflowStepError({
        code,
        stepKind: "action",
        message,
        result: actionResult,
        cause,
      }));
    };

    const stop = (reason: "timeout" | "cancelled") => {
      if (settled || timedOut || cancelled) return;
      timedOut = reason === "timeout";
      cancelled = reason === "cancelled";
      terminate(child, "SIGTERM");
      forceKillTimer = setTimeout(() => terminate(child, "SIGKILL"), FORCE_KILL_AFTER_MS);
      forceKillTimer.unref?.();
    };

    const onAbort = () => stop("cancelled");

    if (signal?.aborted) {
      const actionResult = result(null, null);
      fail("action-cancelled", `action cancelled before launch: ${spec.executable}`, actionResult);
      return;
    }

    try {
      child = spawn(spec.executable, spec.arguments, {
        cwd: spec.cwd,
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      settled = true;
      const actionResult = result(null, null);
      fail(
        "action-launch-failed",
        `action launch failed: ${spec.executable}: ${error instanceof Error ? error.message : String(error)}`,
        actionResult,
        error,
      );
      return;
    }

    child.stdout?.on("data", (chunk) => stdout.append(chunk));
    child.stderr?.on("data", (chunk) => stderr.append(chunk));
    child.stdin?.on("error", () => {
      // A fast-exiting child may close stdin before the write completes.
    });
    child.stdin?.end(spec.stdin);

    const timeout = setTimeout(() => stop("timeout"), spec.timeoutMs);
    timeout.unref?.();
    signal?.addEventListener("abort", onAbort, { once: true });

    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      const actionResult = result(null, null);
      fail(
        "action-launch-failed",
        `action launch failed: ${spec.executable}: ${error.message}`,
        actionResult,
        error,
      );
    });

    child.once("close", (status, exitSignal) => {
      if (settled) return;
      settled = true;
      cleanup();
      const actionResult = result(status, exitSignal);
      if (cancelled) {
        fail("action-cancelled", `action cancelled: ${spec.executable}`, actionResult);
      } else if (timedOut) {
        fail(
          "action-timeout",
          `action timed out after ${spec.timeoutMs}ms: ${spec.executable}`,
          actionResult,
        );
      } else if (status !== 0) {
        fail(
          "action-nonzero-exit",
          `action exited ${status}: ${spec.executable}: ${failureContext(actionResult.stderr, actionResult.stdout)}`,
          actionResult,
        );
      } else {
        resolve(actionResult);
      }
    });
  });
}
