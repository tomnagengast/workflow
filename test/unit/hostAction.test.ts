import { describe, expect, it } from "bun:test";
import {
  normalizeHostActionSpec,
  runHostAction,
} from "../../src/runtime/hostAction.ts";
import { WorkflowStepError } from "../../src/runtime/failures.ts";

function action(
  script: string,
  {
    arguments: values = [],
    cwd = process.cwd(),
    stdin,
    timeoutMs = 5000,
  }: {
    arguments?: string[];
    cwd?: string;
    stdin?: string;
    timeoutMs?: number;
  } = {},
) {
  return {
    executable: process.execPath,
    arguments: ["-e", script, "--", ...values],
    cwd,
    stdin,
    timeoutMs,
  };
}

async function failure(promise: Promise<unknown>): Promise<WorkflowStepError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(WorkflowStepError);
    return error as WorkflowStepError;
  }
  throw new Error("expected action to fail");
}

describe("host actions", () => {
  it("preserves argv, stdin, and the selected working directory", async () => {
    const stdin = "line one\nline $two\n";
    const result = await runHostAction(action(
      `
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
  process.stdout.write(JSON.stringify({
    argv: process.argv.slice(-3),
    stdin: input,
    cwd: process.cwd(),
  }));
});
`,
      {
        arguments: ["space value", "$HOME", "semi;colon"],
        cwd: import.meta.dir,
        stdin,
      },
    ));
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      argv: ["space value", "$HOME", "semi;colon"],
      stdin,
      cwd: import.meta.dir,
    });
  });

  it("returns bounded stdout and stderr metadata", async () => {
    const result = await runHostAction(action(`
process.stdout.write("STDOUT-HEAD-" + "x".repeat(2 * 1024 * 1024) + "-STDOUT-TAIL");
process.stderr.write("STDERR-HEAD-" + "y".repeat(2 * 1024 * 1024) + "-STDERR-TAIL");
`));
    expect(result.stdoutTruncated).toBe(true);
    expect(result.stderrTruncated).toBe(true);
    expect(result.stdoutBytes).toBeGreaterThan(1024 * 1024);
    expect(result.stderrBytes).toBeGreaterThan(1024 * 1024);
    expect(result.stdout).toStartWith("STDOUT-HEAD-");
    expect(result.stdout).toEndWith("-STDOUT-TAIL");
    expect(result.stderr).toStartWith("STDERR-HEAD-");
    expect(result.stderr).toEndWith("-STDERR-TAIL");
    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(1024 * 1024);
    expect(Buffer.byteLength(result.stderr)).toBeLessThanOrEqual(1024 * 1024);
  });

  it("throws a typed failure with bounded context on nonzero exit", async () => {
    const error = await failure(runHostAction(action(`
process.stderr.write("QUOTA-HEAD\\n" + "x".repeat(40 * 1024) + "\\nQUOTA-TAIL");
process.exit(7);
`)));
    expect(error.code).toBe("action-nonzero-exit");
    expect(error.result?.status).toBe(7);
    expect(error.message).toStartWith("action exited 7");
    expect(error.message).toContain("QUOTA-HEAD");
    expect(error.message).toEndWith("QUOTA-TAIL");
  });

  it("throws a typed launch failure for a missing executable", async () => {
    const error = await failure(runHostAction({
      executable: "/definitely/missing/workflow-action",
      arguments: [],
      cwd: process.cwd(),
      timeoutMs: 1000,
    }));
    expect(error.code).toBe("action-launch-failed");
    expect(error.result?.status).toBeNull();
  });

  it("terminates and reports a timeout", async () => {
    const error = await failure(runHostAction(action(
      `setInterval(() => {}, 1000);`,
      { timeoutMs: 50 },
    )));
    expect(error.code).toBe("action-timeout");
    expect(error.result?.timedOut).toBe(true);
    expect(error.result?.cancelled).toBe(false);
  });

  it("terminates and reports cancellation", async () => {
    const controller = new AbortController();
    const running = runHostAction(action(`setInterval(() => {}, 1000);`), controller.signal);
    setTimeout(() => controller.abort(), 50);
    const error = await failure(running);
    expect(error.code).toBe("action-cancelled");
    expect(error.result?.cancelled).toBe(true);
    expect(error.result?.timedOut).toBe(false);
  });
});

describe("host action validation", () => {
  it("normalizes a relative cwd against the run directory", () => {
    expect(normalizeHostActionSpec({
      executable: "tool",
      arguments: ["one"],
      cwd: "nested",
      timeoutMs: 10,
    }, "/tmp/project")).toEqual({
      executable: "tool",
      arguments: ["one"],
      cwd: "/tmp/project/nested",
      stdin: undefined,
      timeoutMs: 10,
    });
  });

  it.each([
    [{}, "executable"],
    [{ executable: "tool", arguments: "one", timeoutMs: 10 }, "arguments"],
    [{ executable: "tool", arguments: [], timeoutMs: 0 }, "timeoutMs"],
    [{ executable: "tool", arguments: [], timeoutMs: 10, stdin: 1 }, "stdin"],
  ])("rejects an invalid spec", (spec, field) => {
    expect(() => normalizeHostActionSpec(spec, process.cwd()))
      .toThrow(`invalid action: ${field}`);
  });
});
