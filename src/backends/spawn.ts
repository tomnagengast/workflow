// Async process spawn.
//
// Byte-faithful to the monolith's `spawnAsync` (`/Users/tom/cmptr/bin/workflow`
// ~365-384): spawn a child, capture stdout/stderr, and resolve (NEVER reject)
// with `{ error, status, stdout, stderr }`. A spawn-time throw, an `error` event,
// and a clean `close` all map onto the same resolved shape so backends can decide
// what to do. In verbose mode stdout is also teed to our stderr and the child's
// stderr inherits our stderr (so it streams live, hence `stderr` stays "").
//
// Uses node:child_process (supported under Bun) to keep the never-reject + tee
// semantics byte-identical. No top-level await.

import { spawn } from "node:child_process";

/** Resolved result of a spawn. `error` is non-null on spawn failure / 'error'
 * event; `status` is the exit code on clean close (null on error). */
export interface SpawnResult {
  error: Error | null;
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Spawn `bin args`, capture output, resolve (never reject). Byte-identical to
 * the monolith's `spawnAsync`. */
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
        stdio: verbose ? ["ignore", "pipe", "inherit"] : ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({ error: error as Error, status: null, stdout: "", stderr: "" });
      return;
    }
    let stdout = "";
    let stderr = "";
    child.stdout!.on("data", (d) => {
      stdout += d;
      if (verbose) process.stderr.write(d);
    });
    if (child.stderr) child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", (error) => resolve({ error, status: null, stdout, stderr }));
    child.on("close", (status) => resolve({ error: null, status, stdout, stderr }));
  });
}
