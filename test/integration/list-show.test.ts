// Integration tests for the read-only discovery slice: `list` / `show` against a
// controlled fixture `.claude/workflows` tree. Spawns the real CLI as a
// subprocess with a temp HOME so the user-scope discovery root resolves to our
// fixtures, exercising the full path (catalog -> meta eval in vm -> render).
//
// These assertions lock the response shape, including raw, un-flattened `meta`
// carried verbatim in `--json`, scope shadowing, the
// MUTATING substring guard, and the no-meta default row.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const cliPath = path.join(repoRoot, "src", "cli.ts");
const fixtures = path.join(repoRoot, "test", "fixtures", "workflows");

let home: string;
let projectCwd: string;

beforeAll(() => {
  // Temp HOME so `~/.claude/workflows` == our user fixtures.
  home = mkdtempSync(path.join(tmpdir(), "wf-home-"));
  const userWorkflows = path.join(home, ".claude", "workflows");
  mkdirSync(userWorkflows, { recursive: true });
  cpSync(path.join(fixtures, "user"), userWorkflows, { recursive: true });

  // A project cwd carrying its own `.claude/workflows` that shadows user-scope
  // `alpha`. Copied to a temp dir so the test never depends on the fixture path
  // being inside a git repo (repoRoot() may resolve to this repository).
  projectCwd = mkdtempSync(path.join(tmpdir(), "wf-proj-"));
  cpSync(path.join(fixtures, "project", "repo"), projectCwd, { recursive: true });
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(projectCwd, { recursive: true, force: true });
});

/** Run the CLI as a subprocess with the controlled HOME. Returns trimmed stdout
 * and the exit code. NO_COLOR is left unset; the caller decides. */
async function runCli(
  args: string[],
  env: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string; code: number }> {
  const proc = Bun.spawn(["bun", "run", cliPath, ...args], {
    cwd: repoRoot,
    env: { ...process.env, HOME: home, ...env },
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

describe("list", () => {
  test("--json carries the raw un-flattened meta verbatim", async () => {
    const { stdout, code } = await runCli(["list", "--json"]);
    expect(code).toBe(0);
    const rows = JSON.parse(stdout) as Array<Record<string, unknown>>;
    const names = rows.map((r) => r.name);
    // sorted by name; user-scope alpha/beta/nometa present.
    expect(names).toEqual(["alpha", "beta", "nometa"]);

    const alpha = rows.find((r) => r.name === "alpha")!;
    // flattened fields
    expect(alpha.scope).toBe("user");
    expect(alpha.mutating).toBe(false);
    expect(alpha.phases).toEqual(["Plan", "Build"]);
    expect(alpha.description).toBe(
      "First fixture workflow with collapsed whitespace.",
    );
    // raw meta verbatim: un-flattened phase objects + extra author keys survive
    const meta = alpha.meta as Record<string, unknown>;
    expect(meta.phases).toEqual([{ title: "Plan" }, { title: "Build" }]);
    expect(meta.author).toBe("fixture");
    expect(meta.tags).toEqual(["a", "b"]);
  });

  test("MUTATING substring marks the row; bare-string phases flatten", async () => {
    const { stdout } = await runCli(["list", "--json"]);
    const rows = JSON.parse(stdout) as Array<Record<string, unknown>>;
    const beta = rows.find((r) => r.name === "beta")!;
    expect(beta.mutating).toBe(true);
    expect(beta.phases).toEqual(["Scan", "Report"]);
  });

  test("no-meta workflow gets the synthesized default row", async () => {
    const { stdout } = await runCli(["list", "--json"]);
    const rows = JSON.parse(stdout) as Array<Record<string, unknown>>;
    const nometa = rows.find((r) => r.name === "nometa")!;
    expect(nometa.description).toBe("");
    expect(nometa.phases).toEqual([]);
    expect(nometa.mutating).toBe(false);
  });

  test("plain output is uncolored when piped (NO_COLOR-equivalent)", async () => {
    const { stdout } = await runCli(["list"], { NO_COLOR: "1" });
    // No ANSI escape sequences; node-faithful color gating.
    expect(stdout).not.toContain("[");
    expect(stdout).toContain("• alpha");
    expect(stdout).toContain(" mutating ");
  });
});

describe("show", () => {
  test("plain key: value lines", async () => {
    const { stdout, code } = await runCli(["show", "alpha"], { NO_COLOR: "1" });
    expect(code).toBe(0);
    expect(stdout).toContain("name: alpha");
    expect(stdout).toContain("scope: user");
    expect(stdout).toContain("mutating: false");
    expect(stdout).toContain("phases: Plan, Build");
  });

  test("--json includes the raw meta", async () => {
    const { stdout, code } = await runCli(["show", "alpha", "--json"]);
    expect(code).toBe(0);
    const row = JSON.parse(stdout) as Record<string, unknown>;
    expect(row.name).toBe("alpha");
    expect((row.meta as Record<string, unknown>).author).toBe("fixture");
  });

  test("unknown workflow exits non-zero with sorted available list", async () => {
    const { stderr, code } = await runCli(["show", "does-not-exist"]);
    expect(code).toBe(1);
    expect(stderr).toContain("Unknown workflow 'does-not-exist'");
    expect(stderr).toContain("Available: alpha, beta, nometa");
  });

  test("invalid workflow name is rejected", async () => {
    const { stderr, code } = await runCli(["show", "../etc"]);
    expect(code).toBe(1);
    expect(stderr).toContain("Invalid workflow name: ../etc");
  });
});

describe("discovery precedence", () => {
  test("project scope shadows user scope for the same name", async () => {
    const { stdout, code } = await runCli(
      ["--cwd", projectCwd, "show", "alpha", "--json"],
      { NO_COLOR: "1" },
    );
    expect(code).toBe(0);
    const row = JSON.parse(stdout) as Record<string, unknown>;
    expect(row.scope).toBe("project");
    expect(row.description).toBe("Project-scope alpha shadows the user-scope one.");
    expect(row.phases).toEqual(["Override"]);
  });
});
