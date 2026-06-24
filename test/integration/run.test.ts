// Integration — `run` against fake backend bins.
//
// Spawns the CLI (bun run src/cli.ts) the way a user / CI would, pointed at the
// committed `run-home/.claude/workflows` fixtures and the shared fake-{claude,
// codex}.mjs bins. Asserts the full runner surface end-to-end: agent fan-out,
// parallel null-on-throw, pipeline per-item stages, gate on the OPPOSITE backend,
// nested workflow(), budget accounting, and the stdout/stderr split.

import { describe, expect, it } from "bun:test";
import path from "node:path";

const REPO = path.resolve(import.meta.dir, "..", "..");
const CLI = path.join(REPO, "src", "cli.ts");
const RUN_HOME = path.join(REPO, "test", "fixtures", "run-home");
const FAKE_CLAUDE = path.join(REPO, "test", "fixtures", "fake-claude.mjs");
const FAKE_CODEX = path.join(REPO, "test", "fixtures", "fake-codex.mjs");

async function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], {
    cwd: REPO,
    env: { ...process.env, NO_COLOR: "1" },
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
