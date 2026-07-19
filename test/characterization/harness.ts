// Black-box CLI snapshot harness.
//
// This module builds a controlled fixture environment (temp HOME carrying known
// `~/.claude/workflows`, a non-git temp cwd so project discovery stays empty),
// runs the CLI with deterministic settings, redacts volatile temp paths, and
// compares the result with committed snapshots. Set WF_UPDATE_SNAPSHOTS=1 to
// accept an intentional CLI output change.
//
// Engine-dependent surfaces, such as JSON.parse error text, are checked
// structurally instead of being snapshotted byte-for-byte.
//
// No top-level await: all spawning is async inside exported functions.

import { expect } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "..", "..");
export const CLI_PATH = path.join(REPO_ROOT, "src", "cli.ts");
export const FIXTURES = path.join(REPO_ROOT, "test", "fixtures");
export const FAKE_CLAUDE = path.join(FIXTURES, "fake-claude.mjs");
export const FAKE_CODEX = path.join(FIXTURES, "fake-codex.mjs");
export const SNAPSHOT_DIR = path.join(here, "snapshots");

/** Set WF_UPDATE_SNAPSHOTS=1 to accept the current CLI output as the contract. */
export const UPDATE = process.env.WF_UPDATE_SNAPSHOTS === "1";

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** A controlled fixture environment: a temp HOME with a known
 * `~/.claude/workflows`, and a non-git temp cwd. Call `dispose()` when done. */
export interface FixtureEnv {
  home: string;
  cwd: string;
  /** A redactor that rewrites volatile absolute paths to stable placeholders so
   * snapshots are reproducible across machines/runs. */
  redact: (s: string) => string;
  dispose: () => void;
}

/** Build a fixture env. `workflowsDir` is copied into `$HOME/.claude/workflows`. */
export function makeEnv(workflowsDir: string): FixtureEnv {
  const home = mkdtempSync(path.join(tmpdir(), "wf-char-home-"));
  const dest = path.join(home, ".claude", "workflows");
  mkdirSync(dest, { recursive: true });
  cpSync(workflowsDir, dest, { recursive: true });
  // A bare temp dir, NOT a git repo, so `repoRoot()` returns null and project
  // discovery collapses to just this cwd (which has no `.claude/workflows`).
  const cwd = mkdtempSync(path.join(tmpdir(), "wf-char-cwd-"));

  const redact = (s: string): string =>
    s
      .split(home)
      .join("<HOME>")
      .split(cwd)
      .join("<CWD>");

  return {
    home,
    cwd,
    redact,
    dispose() {
      rmSync(home, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    },
  };
}

async function spawn(
  bin: string[],
  env: FixtureEnv,
): Promise<RunResult> {
  const proc = Bun.spawn(bin, {
    cwd: env.cwd,
    env: { ...process.env, HOME: env.home, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { stdout, stderr, code };
}

/** Run the CLI (`bun run src/cli.ts`) with the controlled env. */
export function runCli(env: FixtureEnv, args: string[]): Promise<RunResult> {
  return spawn(["bun", "run", CLI_PATH, "--cwd", env.cwd, ...args], env);
}

/** Read a committed snapshot, or `null` if it doesn't exist yet. */
export function readSnapshot(name: string): string | null {
  const file = path.join(SNAPSHOT_DIR, name);
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

/** Write a committed snapshot. */
export function writeSnapshot(name: string, content: string): void {
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  writeFileSync(path.join(SNAPSHOT_DIR, name), content);
}

/**
 * Run the CLI, optionally update the named snapshot, and assert the current
 * output matches the committed contract.
 *
 * `opts` selects which redacted fields make up the snapshot body (default:
 * stdout + exit code; stderr is opt-in because some commands' stderr is
 * order-nondeterministic — those pass `includeStderr:false` and check stderr
 * structurally in the test).
 */
export async function characterize(
  env: FixtureEnv,
  name: string,
  args: string[],
  opts: { includeStdout?: boolean; includeStderr?: boolean } = {},
): Promise<RunResult> {
  const includeStdout = opts.includeStdout ?? true;
  const includeStderr = opts.includeStderr ?? false;

  const render = (r: RunResult): string => {
    const parts: string[] = [`exit: ${r.code}`];
    if (includeStdout) parts.push("--- stdout ---", env.redact(r.stdout).trimEnd());
    if (includeStderr) parts.push("--- stderr ---", env.redact(r.stderr).trimEnd());
    return parts.join("\n") + "\n";
  };

  const result = await runCli(env, args);
  if (UPDATE) writeSnapshot(name, render(result));

  const snapshot = readSnapshot(name);
  if (snapshot === null) {
    throw new Error(
      `No committed snapshot '${name}'. Run with WF_UPDATE_SNAPSHOTS=1 to create it.`,
    );
  }

  expect(render(result)).toBe(snapshot);
  return result;
}
