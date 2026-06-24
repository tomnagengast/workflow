// Integration tests for the Phase 6 read-only diagnostic commands: `validate`
// and `doctor`. Spawns the real CLI as a subprocess with a controlled HOME so the
// user-scope discovery root resolves to our fixtures, exercising the full path
// (catalog -> AST validate / realpath report).
//
// `validate` is checked by NAME (catalog lookup) and by PATH (file on disk), for
// both an accepted and each rejected class, in plain + --json shapes. `doctor` is
// checked for its backend / discovery-root / catalog-count report, including a
// constructed duplicate-realpath shadowing case (two roots symlinked to the same
// physical dir).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const cliPath = path.join(repoRoot, "src", "cli.ts");
const fixtures = path.join(repoRoot, "test", "fixtures", "workflows");
const validateFixtures = path.join(repoRoot, "test", "fixtures", "validate");

let home: string;

beforeAll(() => {
  // Temp HOME so `~/.claude/workflows` == our user fixtures (alpha/beta/nometa).
  home = mkdtempSync(path.join(tmpdir(), "wf-vd-home-"));
  const userWorkflows = path.join(home, ".claude", "workflows");
  mkdirSync(userWorkflows, { recursive: true });
  cpSync(path.join(fixtures, "user"), userWorkflows, { recursive: true });
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

/** Run the CLI as a subprocess with a controlled HOME + cwd. */
async function runCli(
  args: string[],
  opts: { cwd?: string; env?: Record<string, string> } = {},
): Promise<{ stdout: string; stderr: string; code: number }> {
  const proc = Bun.spawn(["bun", "run", cliPath, ...args], {
    cwd: opts.cwd ?? repoRoot,
    env: { ...process.env, HOME: home, NO_COLOR: "1", ...(opts.env ?? {}) },
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

describe("validate", () => {
  test("by NAME (catalog) accepts a valid workflow", async () => {
    const { stdout, code } = await runCli(["validate", "alpha"]);
    expect(code).toBe(0);
    expect(stdout).toMatch(/^ok: .*alpha\.js\n$/);
  });

  test("by NAME rejects the no-meta fixture (meta-first contract)", async () => {
    // `nometa.js` synthesizes a default row in the catalog, so it resolves by
    // name, but the validator rejects it because the first statement is not
    // `export const meta = { ... }`.
    const { stderr, code } = await runCli(["validate", "nometa"]);
    expect(code).toBe(1);
    expect(stderr).toMatch(/first statement must be `export const meta/);
  });

  test("unknown NAME surfaces the sorted Available list", async () => {
    const { stderr, code } = await runCli(["validate", "no-such-workflow"]);
    expect(code).toBe(1);
    expect(stderr).toMatch(/Unknown workflow 'no-such-workflow'\. Available: alpha, beta, nometa/);
  });

  test("by PATH --json reports a valid file", async () => {
    const file = path.join(validateFixtures, "good", "top-level-return-await.js");
    const { stdout, code } = await runCli(["validate", file, "--json"]);
    expect(code).toBe(0);
    const report = JSON.parse(stdout) as Record<string, unknown>;
    expect(report.valid).toBe(true);
    expect(report.name).toBe("top-level-return-await");
    expect(report.path).toBe(file);
    expect(report.error).toBeUndefined();
  });

  test("by PATH --json reports each banned construct", async () => {
    const cases: Array<[string, RegExp]> = [
      ["date-now.js", /Date\.now\(\)/],
      ["math-random.js", /Math\.random\(\)/],
      ["argless-new-date.js", /argless new Date\(\)/],
    ];
    for (const [fixture, pattern] of cases) {
      const file = path.join(validateFixtures, "bad", fixture);
      const { stdout, code } = await runCli(["validate", file, "--json"]);
      expect(code).toBe(1);
      const report = JSON.parse(stdout) as Record<string, unknown>;
      expect(report.valid).toBe(false);
      expect(String(report.error)).toMatch(pattern);
    }
  });

  test("by PATH to a missing file errors clearly", async () => {
    const { stderr, code } = await runCli([
      "validate",
      path.join(validateFixtures, "good", "does-not-exist.js"),
    ]);
    expect(code).toBe(1);
    expect(stderr).toMatch(/Workflow file not found:/);
  });
});

describe("doctor", () => {
  test("--json reports backends, roots (realpath), and catalog count", async () => {
    const { stdout, code } = await runCli(["doctor", "--json"]);
    expect(code).toBe(0);
    const report = JSON.parse(stdout) as {
      version: string;
      bun: string;
      backends: Array<{ name: string; onPath: boolean }>;
      roots: Array<{ scope: string; dir: string; realpath: string | null; shadows: boolean }>;
      catalogCount: number;
    };
    expect(typeof report.version).toBe("string");
    expect(report.bun).toBe(Bun.version);
    expect(report.backends.map((b) => b.name)).toEqual(["claude", "codex"]);
    // user root present, pointing at our temp HOME fixtures, catalog = 3.
    expect(report.roots.some((r) => r.scope === "user")).toBe(true);
    expect(report.catalogCount).toBe(3);
  });

  test("plain output names the discovery root and catalog count", async () => {
    const { stdout, code } = await runCli(["doctor"]);
    expect(code).toBe(0);
    expect(stdout).toMatch(/^workflow .* \(bun /m);
    expect(stdout).toMatch(/backends:/);
    expect(stdout).toMatch(/discovery roots:/);
    expect(stdout).toMatch(/catalog: 3 workflows/);
  });

  test("flags duplicate-realpath shadowing across roots", async () => {
    // Build a cwd whose project `.claude/workflows` is a SYMLINK to the user
    // root's physical dir. workflowDirs then lists two roots (user + project)
    // resolving to the SAME realpath -> doctor must flag the shadowing.
    const realWorkflows = path.join(home, ".claude", "workflows");
    const projCwd = mkdtempSync(path.join(tmpdir(), "wf-vd-proj-"));
    const projClaude = path.join(projCwd, ".claude");
    mkdirSync(projClaude, { recursive: true });
    symlinkSync(realWorkflows, path.join(projClaude, "workflows"));
    try {
      const { stdout, code } = await runCli(["doctor", "--json"], { cwd: projCwd });
      expect(code).toBe(0);
      const report = JSON.parse(stdout) as {
        roots: Array<{ scope: string; shadows: boolean }>;
      };
      // At least two roots share a realpath -> at least one is flagged.
      expect(report.roots.filter((r) => r.shadows).length).toBeGreaterThanOrEqual(2);
    } finally {
      rmSync(projCwd, { recursive: true, force: true });
    }
  });
});
