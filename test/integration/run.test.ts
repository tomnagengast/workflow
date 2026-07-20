// Integration — `run` against fake backend bins.
//
// Spawns the CLI (bun run src/cli.ts) the way a user / CI would, pointed at the
// committed `run-home/.claude/workflows` fixtures and the shared fake-{claude,
// codex}.mjs bins. Asserts the full runner surface end-to-end: agent fan-out,
// parallel null-on-throw, pipeline per-item stages, gate on the OPPOSITE backend,
// nested workflow(), budget accounting, and the stdout/stderr split.

import { describe, expect, it } from "bun:test";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO = path.resolve(import.meta.dir, "..", "..");
const CLI = path.join(REPO, "src", "cli.ts");
const RUN_HOME = path.join(REPO, "test", "fixtures", "run-home");
const FAKE_CLAUDE = path.join(REPO, "test", "fixtures", "fake-claude.mjs");
const FAKE_CODEX = path.join(REPO, "test", "fixtures", "fake-codex.mjs");

async function runCli(
  args: string[],
  env: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], {
    cwd: REPO,
    env: { ...process.env, ...env, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout, stderr };
}

function capturedArgs(file: string): string[][] {
  return readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

const baseArgs = [
  "--cwd", RUN_HOME, "run", "runner-demo",
  "--claude-bin", FAKE_CLAUDE, "--codex-bin", FAKE_CODEX,
];

describe("run runner-demo (claude orchestrator)", () => {
  it("exits 0, prints the result to stdout only, banner+logs to stderr", async () => {
    const { code, stdout, stderr } = await runCli(baseArgs);
    expect(code).toBe(0);
    const result = JSON.parse(stdout);

    // agent fan-out: 2 succeed, 1 thrown thunk -> null
    expect(result.fan).toEqual(["fake-claude: alpha task", "fake-claude: beta task"]);
    expect(result.fanNulls).toBe(1);

    // pipeline: 2 items, 2 stages each, stage-2 sees stage-1's output
    expect(result.piped).toEqual([
      "fake-claude: stage-2 one: fake-claude: stage-1 one",
      "fake-claude: stage-2 two: fake-claude: stage-1 two",
    ]);

    // gate runs on the OPPOSITE backend (codex) and returns a schema object
    expect(result.verdictApproved).toBe(true);

    // nested workflow() received its args and dispatched its own agent
    expect(result.nested).toEqual({
      leaf: "fake-claude: leaf task: from-runner-demo",
      gotArgs: { note: "from-runner-demo" },
    });

    // budget accounting: 7 successful claude agent calls @ 7 tokens each = 49
    // (the gate runs on codex which surfaces 0 tokens)
    expect(result.spent).toBe(49);

    // stdout must be JUST the result (no log lines)
    expect(stdout.trimEnd()).toBe(JSON.stringify(result, null, 2));
    // stderr carries the banner + the opposite-backend gate dispatch
    expect(stderr).toContain("[workflow] backend=claude concurrency=");
    expect(stderr).toContain("gate start [codex]");
  });
});

describe("run guards", () => {
  it("rejects an unknown backend (exit 1)", async () => {
    const { code, stderr } = await runCli([...baseArgs, "--backend", "gpt"]);
    expect(code).toBe(1);
    expect(stderr).toContain("Unknown backend 'gpt' (expected: claude | codex)");
  });

  it("refuses a mutating workflow without --allow-mutating (exit 1)", async () => {
    const { code, stderr } = await runCli([
      "--cwd", RUN_HOME, "run", "mutator",
      "--claude-bin", FAKE_CLAUDE,
    ]);
    expect(code).toBe(1);
    expect(stderr).toContain("Refusing to run mutating workflow 'mutator' without --allow-mutating.");
  });

  it("allows the mutating workflow with --allow-mutating (exit 0)", async () => {
    const { code, stdout } = await runCli([
      "--cwd", RUN_HOME, "run", "mutator",
      "--claude-bin", FAKE_CLAUDE, "--allow-mutating",
    ]);
    expect(code).toBe(0);
    expect(stdout.trim()).toBe("fake-claude: mutate the repo");
  });
});

describe("run explicit workflow file", () => {
  it("loads the file outside --cwd while agents run from --cwd", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "workflow-explicit-file-"));
    try {
      const project = path.join(dir, "project");
      const capture = path.join(dir, "codex-args.jsonl");
      const source = path.join(RUN_HOME, ".claude", "workflows", "mutator.js");
      mkdirSync(project);

      const { code, stdout } = await runCli(
        [
          "--cwd", project, "run", source,
          "--backend", "codex", "--codex-bin", FAKE_CODEX, "--allow-mutating",
        ],
        { WORKFLOW_TEST_CODEX_ARGS: capture },
      );

      expect(code).toBe(0);
      expect(stdout.trim()).toBe("fake-codex: mutate the repo");
      const args = capturedArgs(capture)[0]!;
      expect(args.slice(args.indexOf("--cd"), args.indexOf("--cd") + 2)).toEqual(["--cd", project]);
      expect(existsSync(path.join(project, ".claude"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a missing explicit workflow file", async () => {
    const missing = path.join(tmpdir(), "missing-explicit-workflow.js");
    const { code, stderr } = await runCli(["run", missing]);
    expect(code).toBe(1);
    expect(stderr).toContain(`Workflow file not found: ${missing}`);
  });
});

describe("run with codex orchestrator", () => {
  it("flips backends: agent on codex, gate on claude", async () => {
    const { code, stdout, stderr } = await runCli([...baseArgs, "--backend", "codex"]);
    expect(code).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.fan).toEqual(["fake-codex: alpha task", "fake-codex: beta task"]);
    expect(result.verdictApproved).toBe(true);
    expect(stderr).toContain("[workflow] backend=codex concurrency=");
    expect(stderr).toContain("gate start [claude]");
  });
});

describe("model routing", () => {
  it("passes the model only to the selected backend", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "workflow-model-routing-"));
    try {
      for (const testCase of [
        { backend: "codex", model: "gpt-5.6-sol", selected: "codex", gate: "claude" },
        { backend: "claude", model: "sonnet", selected: "claude", gate: "codex" },
      ]) {
        const claudeCapture = path.join(dir, `${testCase.backend}-claude.jsonl`);
        const codexCapture = path.join(dir, `${testCase.backend}-codex.jsonl`);
        const { code } = await runCli(
          [...baseArgs, "--backend", testCase.backend, "--model", testCase.model],
          {
            WORKFLOW_TEST_CLAUDE_ARGS: claudeCapture,
            WORKFLOW_TEST_CODEX_ARGS: codexCapture,
          },
        );
        expect(code).toBe(0);

        const calls = {
          claude: capturedArgs(claudeCapture),
          codex: capturedArgs(codexCapture),
        };
        expect(calls[testCase.selected as "claude" | "codex"].length).toBeGreaterThan(0);
        expect(calls[testCase.gate as "claude" | "codex"].length).toBeGreaterThan(0);
        for (const args of calls[testCase.selected as "claude" | "codex"]) {
          expect(args).toContain("--model");
          expect(args).toContain(testCase.model);
        }
        for (const args of calls[testCase.gate as "claude" | "codex"]) {
          expect(args).not.toContain("--model");
          expect(args).not.toContain(testCase.model);
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("routes an explicitly selected gate reviewer and keeps selected-backend model settings", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "workflow-reviewer-routing-"));
    try {
      const claudeCapture = path.join(dir, "claude.jsonl");
      const codexCapture = path.join(dir, "codex.jsonl");
      const { code, stdout } = await runCli(
        [
          "--cwd", RUN_HOME, "run", "reviewer-routing",
          "--backend", "codex", "--model", "gpt-5.6-sol",
          "--claude-bin", FAKE_CLAUDE, "--codex-bin", FAKE_CODEX,
        ],
        {
          WORKFLOW_TEST_CLAUDE_ARGS: claudeCapture,
          WORKFLOW_TEST_CODEX_ARGS: codexCapture,
        },
      );
      expect(code).toBe(0);
      expect(JSON.parse(stdout)).toEqual({
        codex: expect.objectContaining({ approved: true }),
        claude: expect.objectContaining({ approved: true }),
      });
      const codex = capturedArgs(codexCapture)[0]!;
      const claude = capturedArgs(claudeCapture)[0]!;
      expect(codex).toContain("--model");
      expect(codex).toContain("gpt-5.6-sol");
      expect(claude).not.toContain("--model");
      expect(claude).not.toContain("gpt-5.6-sol");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("human review", () => {
  it("suspends with a durable gate request and resumes from an appended human result", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "workflow-human-review-"));
    const journal = path.join(dir, "journal.jsonl");
    try {
      const first = await runCli([
        "--cwd", RUN_HOME, "run", "human-review", "--journal", journal,
      ]);
      expect(first.code).toBe(75);
      expect(first.stdout).toBe("");
      expect(first.stderr).toContain("suspended for human review");

      const suspended = readFileSync(journal, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      expect(suspended.map((event) => event.type)).toEqual([
        "runtime.started",
        "phase.started",
        "step.started",
        "runtime.suspended",
      ]);
      expect(suspended[2]).toEqual(expect.objectContaining({
        backend: "human",
        kind: "gate",
        message: "Should this workflow continue?",
      }));
      expect(suspended[2].schema).toBeUndefined();
      expect(suspended[3]).toEqual(expect.objectContaining({
        stepId: suspended[2].stepId,
        key: suspended[2].key,
        backend: "human",
      }));

      appendFileSync(journal, JSON.stringify({
        sequence: 5,
        at: "2026-07-19T12:00:00.000Z",
        type: "step.completed",
        workflow: "human-review",
        phase: "Review",
        stepId: suspended[2].stepId,
        key: suspended[2].key,
        agentId: suspended[2].agentId,
        backend: "human",
        kind: "gate",
        result: "Reviewed by a human.",
      }) + "\n");

      const resumed = await runCli([
        "--cwd", RUN_HOME, "run", "human-review",
        "--journal", journal, "--resume", journal,
      ]);
      expect(resumed.code).toBe(0);
      expect(resumed.stdout.trim()).toBe("Reviewed by a human.");
      const complete = readFileSync(journal, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      expect(complete.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
      expect(complete.slice(5).map((event) => event.type)).toEqual([
        "runtime.resumed",
        "phase.started",
        "step.cached",
        "runtime.completed",
      ]);
      expect(complete[7]).toEqual(expect.objectContaining({
        backend: "human",
        result: "Reviewed by a human.",
      }));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("finishes active parallel agent calls before recording suspension", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "workflow-human-parallel-"));
    const journal = path.join(dir, "journal.jsonl");
    try {
      const result = await runCli([
        "--cwd", RUN_HOME, "run", "human-parallel",
        "--backend", "claude", "--claude-bin", FAKE_CLAUDE,
        "--journal", journal,
      ]);
      expect(result.code).toBe(75);
      const events = readFileSync(journal, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      expect(events.at(-1)?.type).toBe("runtime.suspended");
      expect(events.some((event) =>
        event.type === "step.completed" && event.backend === "claude"
      )).toBe(true);
      expect(events.findIndex((event) => event.type === "step.completed"))
        .toBeLessThan(events.findIndex((event) => event.type === "runtime.suspended"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("budget hard ceiling", () => {
  it("throws BudgetError once the budget is exhausted (-> exit 1)", async () => {
    // budget 1 < first agent's 7-token charge: the FIRST dispatch succeeds (spent
    // 0 < 1 is false? no: 0 < 1 true, so it runs, spends 7), the SECOND throws.
    // BudgetError propagates through parallel(), so the run rejects (exit 1).
    const { code, stderr } = await runCli([...baseArgs, "--budget", "1"]);
    expect(code).toBe(1);
    expect(stderr).toContain("token budget exhausted");
  });
});

describe("deterministic host actions", () => {
  it("runs top-level and nested actions in journal order and resumes without repeating them", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "workflow-actions-"));
    const root = path.join(dir, "root.js");
    const nested = path.join(dir, "nested.js");
    const journal = path.join(dir, "journal.jsonl");
    const mutations = path.join(dir, "mutations.txt");
    const actionScript = `
import fs from "node:fs";
fs.appendFileSync(process.argv.at(-1), "x");
process.stdout.write(process.cwd());
`;
    try {
      writeFileSync(nested, `export const meta = {
  name: "nested-action",
  description: "Exercise a nested deterministic action.",
  phases: ["Nested"],
  mutating: false,
};
phase("Nested");
return action({
  executable: ${JSON.stringify(process.execPath)},
  arguments: ["-e", ${JSON.stringify(actionScript)}, "--", ${JSON.stringify(mutations)}],
  timeoutMs: 5000,
});
`);
      writeFileSync(root, `export const meta = {
  name: "root-action",
  description: "Exercise deterministic actions.",
  phases: ["Root"],
  mutating: false,
};
phase("Root");
const top = await action({
  executable: ${JSON.stringify(process.execPath)},
  arguments: ["-e", ${JSON.stringify(actionScript)}, "--", ${JSON.stringify(mutations)}],
  stdin: "not journaled",
  timeoutMs: 5000,
});
const child = await workflow({ scriptPath: ${JSON.stringify(nested)} });
return { top, child };
`);

      const first = await runCli([
        "--cwd", dir, "run", root, "--journal", journal,
      ]);
      expect(first.code).toBe(0);
      expect(readFileSync(mutations, "utf8")).toBe("xx");
      const firstResult = JSON.parse(first.stdout);
      expect(firstResult.top).toEqual(expect.objectContaining({
        status: 0,
        stdout: realpathSync(dir),
        timedOut: false,
        cancelled: false,
      }));
      expect(firstResult.child).toEqual(expect.objectContaining({
        status: 0,
        stdout: realpathSync(dir),
      }));

      const firstEvents = readFileSync(journal, "utf8")
        .trim().split("\n").map((line) => JSON.parse(line));
      expect(firstEvents.map((event) => event.sequence)).toEqual(
        Array.from({ length: firstEvents.length }, (_, index) => index + 1),
      );
      expect(firstEvents.filter((event) => event.kind === "action").map((event) => event.type))
        .toEqual(["step.started", "step.completed", "step.started", "step.completed"]);
      expect(firstEvents.filter((event) => event.kind === "action").every(
        (event) => event.backend === "host",
      )).toBe(true);
      expect(firstEvents.find((event) => event.kind === "action")?.message)
        .not.toContain("not journaled");

      const resumed = await runCli([
        "--cwd", dir, "run", root, "--journal", journal, "--resume", journal,
      ]);
      expect(resumed.code).toBe(0);
      expect(readFileSync(mutations, "utf8")).toBe("xx");
      expect(JSON.parse(resumed.stdout)).toEqual(firstResult);
      const allEvents = readFileSync(journal, "utf8")
        .trim().split("\n").map((line) => JSON.parse(line));
      expect(allEvents.filter((event) => event.kind === "action" && event.type === "step.cached"))
        .toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("journals a typed action failure and fails the run", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "workflow-action-failure-"));
    const source = path.join(dir, "failure.js");
    const journal = path.join(dir, "journal.jsonl");
    try {
      writeFileSync(source, `export const meta = {
  name: "action-failure",
  description: "Exercise a nonzero action.",
  phases: ["Run"],
  mutating: false,
};
phase("Run");
return action({
  executable: ${JSON.stringify(process.execPath)},
  arguments: ["-e", "process.stderr.write('action detail'); process.exit(7)"],
  timeoutMs: 5000,
});
`);
      const result = await runCli([
        "--cwd", dir, "run", source, "--journal", journal,
      ]);
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("action exited 7");
      const events = readFileSync(journal, "utf8")
        .trim().split("\n").map((line) => JSON.parse(line));
      expect(events.map((event) => event.type)).toEqual([
        "runtime.started",
        "phase.started",
        "step.started",
        "step.failed",
        "runtime.failed",
      ]);
      expect(events[3]).toEqual(expect.objectContaining({
        kind: "action",
        backend: "host",
        errorCode: "action-nonzero-exit",
        result: expect.objectContaining({ status: 7, stderr: "action detail" }),
      }));
      expect(events[4].errorCode).toBe("action-nonzero-exit");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("drains concurrent steps before writing terminal failure", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "workflow-action-drain-"));
    const source = path.join(dir, "parallel-failure.js");
    const journal = path.join(dir, "journal.jsonl");
    try {
      writeFileSync(source, `export const meta = {
  name: "parallel-action-failure",
  description: "Keep the terminal event last after one concurrent action fails.",
  phases: ["Run"],
  mutating: false,
};
phase("Run");
return parallel([
  () => action({
    executable: ${JSON.stringify(process.execPath)},
    arguments: ["-e", "setTimeout(() => process.exit(7), 10)"],
    timeoutMs: 5000,
  }),
  () => action({
    executable: ${JSON.stringify(process.execPath)},
    arguments: ["-e", "setTimeout(() => process.stdout.write('finished'), 100)"],
    timeoutMs: 5000,
  }),
]);
`);
      const result = await runCli([
        "--cwd", dir, "run", source, "--journal", journal,
      ]);
      expect(result.code).toBe(1);
      const events = readFileSync(journal, "utf8")
        .trim().split("\n").map((line) => JSON.parse(line));
      expect(events.at(-1)?.type).toBe("runtime.failed");
      expect(events.filter((event) =>
        event.kind === "action" &&
        (event.type === "step.completed" || event.type === "step.failed")
      )).toHaveLength(2);
      expect(events.findIndex((event) =>
        event.kind === "action" && event.type === "step.completed"
      )).toBeLessThan(events.length - 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("typed backend failures", () => {
  it("keeps stderr head and tail and fails instead of returning null", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "workflow-backend-failure-"));
    const bin = path.join(dir, "failing-codex.mjs");
    const journal = path.join(dir, "journal.jsonl");
    try {
      writeFileSync(bin, `#!/usr/bin/env node
process.stderr.write("QUOTA-HEAD\\n" + "x".repeat(40 * 1024) + "\\nQUOTA-TAIL");
process.exit(9);
`);
      chmodSync(bin, 0o755);
      const result = await runCli([
        "--cwd", RUN_HOME, "run", "mutator",
        "--backend", "codex", "--codex-bin", bin,
        "--allow-mutating", "--journal", journal,
      ]);
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("QUOTA-HEAD");
      expect(result.stderr).toContain("QUOTA-TAIL");
      const events = readFileSync(journal, "utf8")
        .trim().split("\n").map((line) => JSON.parse(line));
      const failed = events.find((event) => event.type === "step.failed");
      expect(failed).toEqual(expect.objectContaining({
        kind: "agent",
        errorCode: "backend-failed",
      }));
      expect(failed.error).toContain("QUOTA-HEAD");
      expect(failed.error).toContain("QUOTA-TAIL");
      expect(events.at(-1)).toEqual(expect.objectContaining({
        type: "runtime.failed",
        errorCode: "backend-failed",
      }));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps a valid null result successful and resume-cacheable", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "workflow-null-result-"));
    const bin = path.join(dir, "null-codex.mjs");
    const source = path.join(dir, "null-result.js");
    const journal = path.join(dir, "journal.jsonl");
    const calls = path.join(dir, "calls.txt");
    try {
      writeFileSync(bin, `#!/usr/bin/env node
import fs from "node:fs";
const argv = process.argv.slice(2);
const output = argv[argv.indexOf("--output-last-message") + 1];
fs.appendFileSync(${JSON.stringify(calls)}, "x");
fs.writeFileSync(output, "null");
`);
      chmodSync(bin, 0o755);
      writeFileSync(source, `export const meta = {
  name: "null-result",
  description: "Return a valid null agent result.",
  phases: ["Run"],
  mutating: false,
};
phase("Run");
return agent("Return null.", { schema: { type: "null" } });
`);

      const first = await runCli([
        "--cwd", dir, "run", source,
        "--backend", "codex", "--codex-bin", bin,
        "--journal", journal,
      ]);
      expect(first.code).toBe(0);
      expect(first.stdout).toBe("null\n");
      expect(readFileSync(calls, "utf8")).toBe("x");
      const completed = readFileSync(journal, "utf8")
        .trim().split("\n").map((line) => JSON.parse(line))
        .find((event) => event.type === "step.completed");
      expect(completed.result).toBeNull();

      const resumed = await runCli([
        "--cwd", dir, "run", source,
        "--backend", "codex", "--codex-bin", bin,
        "--journal", journal, "--resume", journal,
      ]);
      expect(resumed.code).toBe(0);
      expect(resumed.stdout).toBe("null\n");
      expect(readFileSync(calls, "utf8")).toBe("x");
      const events = readFileSync(journal, "utf8")
        .trim().split("\n").map((line) => JSON.parse(line));
      expect(events.some((event) =>
        event.type === "step.cached" && event.result === null
      )).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
