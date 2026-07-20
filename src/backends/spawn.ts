// Spawn a child, capture stdout/stderr, and resolve (never reject)
// with bounded stdout and stderr. A spawn-time throw, an `error` event, and a
// clean `close` all map onto the same resolved shape so backends can decide what
// to do. In verbose mode both streams are also teed to our stderr.
//
// Uses node:child_process under Bun to preserve the never-reject and tee
// semantics.

import { spawn } from "node:child_process";
import { BoundedOutput } from "../runtime/output.ts";

/** Resolved result of a spawn. `error` is non-null on spawn failure / 'error'
 * event; `status` is the exit code on clean close (null on error). */
export interface SpawnResult {
  error: Error | null;
  status: number | null;
  stdout: string;
  stderr: string;
  stdoutBytes: number;
  stderrBytes: number;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

/** Spawn `bin args`, capture output, and resolve without rejecting. */
export function spawnAsync(
  bin: string,
  args: string[],
  { cwd, verbose }: { cwd: string; verbose: boolean },
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({
        error: error as Error,
        status: null,
        stdout: "",
        stderr: "",
        stdoutBytes: 0,
        stderrBytes: 0,
        stdoutTruncated: false,
        stderrTruncated: false,
      });
      return;
    }
    const stdout = new BoundedOutput();
    const stderr = new BoundedOutput();
    let settled = false;
    const finish = (error: Error | null, status: number | null) => {
      if (settled) return;
      settled = true;
      const out = stdout.value();
      const err = stderr.value();
      resolve({
        error,
        status,
        stdout: out.text,
        stderr: err.text,
        stdoutBytes: out.bytes,
        stderrBytes: err.bytes,
        stdoutTruncated: out.truncated,
        stderrTruncated: err.truncated,
      });
    };
    child.stdout!.on("data", (d) => {
      stdout.append(d);
      if (verbose) process.stderr.write(d);
    });
    child.stderr!.on("data", (d) => {
      stderr.append(d);
      if (verbose) process.stderr.write(d);
    });
    child.on("error", (error) => finish(error, null));
    child.on("close", (status) => finish(null, status));
  });
}
