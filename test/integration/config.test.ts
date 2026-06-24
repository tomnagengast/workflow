// Integration — config as the run defaults layer (`flags > user > defaults`).
//
// Drives the real CLI with $XDG_CONFIG_HOME pointed at a seeded config.toml and
// asserts the resolved-config precedence end-to-end:
//   - `config --print-config` reflects the user file
//   - `run` w/o --backend picks up `backend = "codex"` from the file
//   - an explicit --backend flag still wins over the file (flags > user)

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO = path.resolve(import.meta.dir, "..", "..");
const CLI = path.join(REPO, "src", "cli.ts");
const RUN_HOME = path.join(REPO, "test", "fixtures", "run-home");
const FAKE_CLAUDE = path.join(REPO, "test", "fixtures", "fake-claude.mjs");
const FAKE_CODEX = path.join(REPO, "test", "fixtures", "fake-codex.mjs");

let xdg: string;

beforeEach(() => {
  xdg = mkdtempSync(path.join(os.tmpdir(), "wf-cfg-int-"));
});
afterEach(() => {
  rmSync(xdg, { recursive: true, force: true });
});

function seedConfig(toml: string): void {
  mkdirSync(path.join(xdg, "workflow"), { recursive: true });
  writeFileSync(path.join(xdg, "workflow", "config.toml"), toml, "utf8");
}

async function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], {
    cwd: REPO,
    env: { ...process.env, NO_COLOR: "1", XDG_CONFIG_HOME: xdg },
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

describe("config --print-config", () => {
  it("reflects the user file values and provenance", async () => {
    seedConfig('backend = "codex"\nconcurrency = 8\n');
    const { code, stdout } = await runCli(["config", "--print-config"]);
    expect(code).toBe(0);
    expect(stdout).toContain("backend = codex  [user]");
    expect(stdout).toContain("concurrency = 8  [user]");
    expect(stdout).toContain("codexBin = codex  [default]");
  });

  it("--json emits the structured ResolvedConfig", async () => {
    seedConfig('backend = "codex"\n');
    const { code, stdout } = await runCli(["config", "--json"]);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.loaded).toBe(true);
    expect(parsed.config.backend).toBe("codex");
    expect(parsed.sources.backend).toBe("user");
  });

  it("with no file, every source is 'default'", async () => {
    const { code, stdout } = await runCli(["config", "--json"]);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.loaded).toBe(false);
    expect(parsed.sources.backend).toBe("default");
  });
});

describe("run defaults from config (user > defaults)", () => {
  it("uses backend=codex from the file when no --backend flag", async () => {
    seedConfig('backend = "codex"\n');
    const { code, stdout, stderr } = await runCli([
      "--cwd", RUN_HOME, "run", "runner-demo",
      "--claude-bin", FAKE_CLAUDE, "--codex-bin", FAKE_CODEX,
    ]);
    expect(code).toBe(0);
    // banner reports the config-derived backend
    expect(stderr).toContain("[workflow] backend=codex concurrency=");
    const result = JSON.parse(stdout);
    // codex orchestrator => agent on codex, gate flips to claude
    expect(result.fan).toEqual(["fake-codex: alpha task", "fake-codex: beta task"]);
    expect(stderr).toContain("gate start [claude]");
  });
});

describe("flags override config (flags > user)", () => {
  it("an explicit --backend beats the config file", async () => {
    seedConfig('backend = "codex"\n');
    const { code, stderr } = await runCli([
      "--cwd", RUN_HOME, "run", "runner-demo",
      "--backend", "claude",
      "--claude-bin", FAKE_CLAUDE, "--codex-bin", FAKE_CODEX,
    ]);
    expect(code).toBe(0);
    expect(stderr).toContain("[workflow] backend=claude concurrency=");
  });
});
