// Characterization harness — black-box CLI snapshotting against the live monolith.
//
// Phase 5 locks the monolith's observable behavior as ground truth. This module
// is the shared machinery: it builds a controlled fixture environment (temp HOME
// carrying known `~/.claude/workflows`, a non-git temp cwd so project discovery
// stays empty), spawns both the LIVE MONOLITH and the REWRITE under identical
// conditions (NO_COLOR=1, controlled HOME/cwd, fake backend bins), redacts the
// volatile temp-dir prefix to a stable placeholder, and reads/writes committed
// snapshots.
//
// Snapshots are generated FROM THE MONOLITH (the oracle): they depend only on the
// monolith, not the rewrite. On first run — or when WF_UPDATE_SNAPSHOTS=1 — the
// harness writes the monolith's redacted output to a committed file; on every run
// it asserts the REWRITE's redacted output equals that committed snapshot. So a
// passing test means rewrite-output == recorded-live-monolith-output.
//
// Engine-dependent surfaces (e.g. the V8-vs-JSC JSON.parse error text for an
// invalid `--args`) are deliberately NOT snapshotted byte-for-byte here; the
// monolith runs on node/V8 and the rewrite on Bun/JSC, so those strings diverge
// by construction (same class of divergence the Phase 4 codex-parse fix handled).
// Such cases are characterized structurally (exit code + banner + non-empty
// error) by the test file, not by raw-byte snapshot.
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
export const MONOLITH = "/Users/tom/cmptr/bin/workflow";
export const FIXTURES = path.join(REPO_ROOT, "test", "fixtures");
export const FAKE_CLAUDE = path.join(FIXTURES, "fake-claude.mjs");
export const FAKE_CODEX = path.join(FIXTURES, "fake-codex.mjs");
export const SNAPSHOT_DIR = path.join(here, "snapshots");

/** Set WF_UPDATE_SNAPSHOTS=1 to (re)generate committed snapshots from the
 * monolith. Off in CI: the committed bytes are the contract. */
export const UPDATE = process.env.WF_UPDATE_SNAPSHOTS === "1";

/** Whether the live monolith oracle is present. When absent (e.g. CI without the
 * cmptr checkout) we skip oracle GENERATION but still assert the rewrite against
 * the committed snapshots — the committed bytes remain the contract. */
export const HAS_MONOLITH = existsSync(MONOLITH);

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

/** Run the LIVE MONOLITH (the oracle) with the controlled env. */
export function runMonolith(env: FixtureEnv, args: string[]): Promise<RunResult> {
  return spawn([MONOLITH, "--cwd", env.cwd, ...args], env);
}

/** Run the REWRITE CLI (`bun run src/cli.ts`) with the controlled env. */
export function runRewrite(env: FixtureEnv, args: string[]): Promise<RunResult> {
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
 * The core characterization assertion. For the given `name`:
 *  1. Run the monolith, redact, and — when UPDATE (or the snapshot is missing and
 *     the monolith is present) — record it as the committed snapshot.
 *  2. Run the rewrite, redact, and assert it equals the committed snapshot.
 *
 * `project` selects which redacted fields make up the snapshot body (default:
 * stdout + exit code; stderr is opt-in because some commands' stderr is
 * order-nondeterministic — those pass `includeStderr:false` and check stderr
 * structurally in the test).
 */
export async function characterize(
  env: FixtureEnv,
  name: string,
  args: string[],
  opts: { includeStdout?: boolean; includeStderr?: boolean } = {},
): Promise<{ mono: RunResult | null; rewrite: RunResult }> {
  const includeStdout = opts.includeStdout ?? true;
  const includeStderr = opts.includeStderr ?? false;

  const render = (r: RunResult): string => {
    const parts: string[] = [`exit: ${r.code}`];
    if (includeStdout) parts.push("--- stdout ---", env.redact(r.stdout).trimEnd());
    if (includeStderr) parts.push("--- stderr ---", env.redact(r.stderr).trimEnd());
    return parts.join("\n") + "\n";
  };

  let mono: RunResult | null = null;
  if (UPDATE || (readSnapshot(name) === null && HAS_MONOLITH)) {
    mono = await runMonolith(env, args);
    writeSnapshot(name, render(mono));
  }

  const snapshot = readSnapshot(name);
  if (snapshot === null) {
    throw new Error(
      `No committed snapshot '${name}' and no monolith oracle at ${MONOLITH} to generate one. ` +
        `Run with WF_UPDATE_SNAPSHOTS=1 on a machine that has the monolith.`,
    );
  }

  const rewrite = await runRewrite(env, args);
  expect(render(rewrite)).toBe(snapshot);
  return { mono, rewrite };
}
