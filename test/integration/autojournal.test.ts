// Integration — complete semantic auto-journal + resume --last.
//
// Asserts the new default-on filesystem behavior end-to-end against the fake
// backend bins, all sandboxed under a temp `XDG_STATE_HOME` so nothing touches
// the developer's real `~/.local/state`:
//
//   1. A plain `run` records every semantic runtime observation in order.
//   2. `run --resume-last` (and the `resume --last` alias) replay the newest
//      auto-journal: backends are NOT re-spawned (stderr shows `cached:`), and
//      the result is identical.
//   3. Cross-compat both directions: an auto-journal can be replayed with an
//      explicit `--resume FILE`, and a manual `--journal FILE` can be replayed
//      with `--resume-last` (proving the bytes are interchangeable).

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { JOURNAL_EVENT_TYPES } from "../../src/journal/journal.ts";

const REPO = path.resolve(import.meta.dir, "..", "..");
const CLI = path.join(REPO, "src", "cli.ts");
const RUN_HOME = path.join(REPO, "test", "fixtures", "run-home");
const FAKE_CLAUDE = path.join(REPO, "test", "fixtures", "fake-claude.mjs");
const FAKE_CODEX = path.join(REPO, "test", "fixtures", "fake-codex.mjs");

let stateHome: string;
let journalsDir: string;

beforeEach(() => {
  stateHome = mkdtempSync(path.join(tmpdir(), "wf-state-"));
  journalsDir = path.join(stateHome, "workflow");
});
afterEach(() => {
  rmSync(stateHome, { recursive: true, force: true });
});

async function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], {
    cwd: REPO,
    env: { ...process.env, NO_COLOR: "1", XDG_STATE_HOME: stateHome },
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

const RUN = [
  "--cwd", RUN_HOME, "run", "runner-demo",
  "--claude-bin", FAKE_CLAUDE, "--codex-bin", FAKE_CODEX,
];

/** Parse a run's stdout JSON and drop the `spent` token meter — which
 * legitimately differs between a fresh run and a resumed one (cache hits
 * short-circuit before token accounting). Lets us assert the WORKFLOW output is
 * identical across resume. */
function withoutSpent(stdout: string): Record<string, unknown> {
  const { spent: _spent, ...rest } = JSON.parse(stdout);
  return rest;
}

function listJournals(): string[] {
  let entries: string[];
  try {
    entries = readdirSync(journalsDir);
  } catch {
    return [];
  }
  return entries.filter((e) => e.endsWith(".jsonl")).sort().map((e) => path.join(journalsDir, e));
}

describe("auto-journal (default-on)", () => {
  it("writes the complete ordered semantic event stream", async () => {
    const { code, stdout } = await runCli(RUN);
    expect(code).toBe(0);
    const result = JSON.parse(stdout);

    const files = listJournals();
    expect(files.length).toBe(1);

    const lines = readFileSync(files[0]!, "utf8").split("\n").filter((l) => l.trim());
    expect(lines.length).toBeGreaterThan(0);

    const events = lines.map((l) => JSON.parse(l));
    expect(events.map((event) => event.sequence)).toEqual(
      Array.from({ length: events.length }, (_, index) => index + 1),
    );
    for (const event of events) {
      expect(JOURNAL_EVENT_TYPES).toContain(event.type);
      expect(event.workflow).toBeTruthy();
      expect(Number.isNaN(Date.parse(event.at))).toBe(false);
    }
    expect(events[0].type).toBe("runtime.started");
    expect(events.at(-1).type).toBe("runtime.completed");
    expect(events.some((event) => event.type === "phase.started")).toBe(true);
    expect(events.some((event) => event.type === "log")).toBe(true);
    expect(events.some((event) => event.kind === "workflow")).toBe(true);
    expect(events.find((event) => event.type === "step.started" && event.kind === "agent").message)
      .toContain("TASK");
    const okResults = events.filter((event) =>
      event.type === "step.completed" && event.kind !== "workflow" && event.result !== null && event.key
    );
    expect(okResults.length).toBeGreaterThan(0);

    // result is observable / stable for the cross-resume assertions below
    expect(result.verdictApproved).toBe(true);
  });

  it("records step and runtime failures before exiting", async () => {
    const { code } = await runCli([...RUN, "--budget", "1"]);
    expect(code).toBe(1);
    const events = readFileSync(listJournals()[0]!, "utf8")
      .trim().split("\n").map((line) => JSON.parse(line));
    expect(events.some((event) => event.type === "step.failed")).toBe(true);
    expect(events.at(-1).type).toBe("runtime.failed");
  });
});

describe("resume --last", () => {
  it("replays the newest auto-journal without re-spawning backends (--resume-last)", async () => {
    const first = await runCli(RUN);
    expect(first.code).toBe(0);
    // first run actually dispatched (start lines on stderr, no cached lines)
    expect(first.stderr).toContain("start [");
    expect(first.stderr).not.toContain("cached:");

    // point the SAME run at the auto-journal we just wrote
    const second = await runCli([...RUN, "--resume-last"]);
    expect(second.code).toBe(0);
    // `spent` differs because cache hits short-circuit before token accounting.
    expect(withoutSpent(second.stdout)).toEqual(withoutSpent(first.stdout));
    expect(JSON.parse(second.stdout).spent).toBe(0);
    expect(JSON.parse(first.stdout).spent).toBeGreaterThan(0);
    // and it replayed from cache instead of dispatching
    expect(second.stderr).toContain("cached:");
    expect(second.stderr).not.toContain("start [");
    const replay = readFileSync(listJournals().at(-1)!, "utf8")
      .trim().split("\n").map((line) => JSON.parse(line));
    expect(replay.some((event) => event.type === "step.cached")).toBe(true);
    expect(replay.at(-1).type).toBe("runtime.completed");
  });

  it("`resume --last <workflow>` alias behaves the same as run --resume-last", async () => {
    const first = await runCli(RUN);
    expect(first.code).toBe(0);

    const replayed = await runCli([
      "--cwd", RUN_HOME, "resume", "--last", "runner-demo",
      "--claude-bin", FAKE_CLAUDE, "--codex-bin", FAKE_CODEX,
    ]);
    expect(replayed.code).toBe(0);
    expect(withoutSpent(replayed.stdout)).toEqual(withoutSpent(first.stdout));
    expect(replayed.stderr).toContain("cached:");
  });

  it("picks the NEWEST auto-journal by mtime when several exist", async () => {
    await runCli(RUN);
    await runCli(RUN);
    const files = listJournals();
    expect(files.length).toBe(2);

    // both are valid resume sources; --resume-last must succeed and replay
    const replayed = await runCli([...RUN, "--resume-last"]);
    expect(replayed.code).toBe(0);
    expect(replayed.stderr).toContain("cached:");
  });
});

describe("manual <-> auto cross-resume (format-compatible)", () => {
  it("an auto-journal can be replayed with an explicit --resume FILE", async () => {
    await runCli(RUN);
    const auto = listJournals()[0]!;

    const replayed = await runCli([...RUN, "--resume", auto]);
    expect(replayed.code).toBe(0);
    expect(replayed.stderr).toContain("cached:");
  });

  it("a manual --journal FILE can be replayed with --resume-last", async () => {
    // Write a manual journal OUTSIDE the state dir...
    const manualDir = mkdtempSync(path.join(tmpdir(), "wf-manual-"));
    const manual = path.join(manualDir, "manual.jsonl");
    try {
      const first = await runCli([...RUN, "--journal", manual]);
      expect(first.code).toBe(0);
      // explicit --journal wins: nothing was auto-journaled to the state dir
      expect(listJournals().length).toBe(0);

      // ...then COPY it into the state dir so --resume-last finds it, proving the
      // bytes are interchangeable across the manual/auto boundary.
      mkdirSync(journalsDir, { recursive: true });
      writeFileSync(path.join(journalsDir, "copied.jsonl"), readFileSync(manual, "utf8"));

      const replayed = await runCli([...RUN, "--resume-last"]);
      expect(replayed.code).toBe(0);
      expect(withoutSpent(replayed.stdout)).toEqual(withoutSpent(first.stdout));
      expect(replayed.stderr).toContain("cached:");
    } finally {
      rmSync(manualDir, { recursive: true, force: true });
    }
  });
});
