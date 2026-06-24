// Unit — config layer precedence: `flags > user > defaults` (Phase 7).
//
// `resolveConfig` covers the bottom two layers (user file over defaults). The
// top layer (flags) is applied in `cli/commands/run.ts`; an integration test
// exercises it end-to-end. Here we assert:
//   - no file  -> defaults, every source "default" (byte-compat invariant)
//   - a file   -> recognized keys override, sources flip to "user"
//   - bad values throw, unknown keys ignored
//   - XDG_CONFIG_HOME honored

import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { configPath, defaults, resolveConfig } from "../../src/config/config.ts";

const tmpDirs: string[] = [];

/** Make a fresh fake $XDG_CONFIG_HOME; optionally seed config.toml. */
function fakeHome(toml?: string): NodeJS.ProcessEnv {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wf-config-"));
  tmpDirs.push(dir);
  if (toml !== undefined) {
    mkdirSync(path.join(dir, "workflow"), { recursive: true });
    writeFileSync(path.join(dir, "workflow", "config.toml"), toml, "utf8");
  }
  return { XDG_CONFIG_HOME: dir };
}

afterEach(() => {
  while (tmpDirs.length > 0) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

describe("configPath", () => {
  it("honors XDG_CONFIG_HOME", () => {
    const p = configPath({ XDG_CONFIG_HOME: "/x/cfg" });
    expect(p).toBe(path.join("/x/cfg", "workflow", "config.toml"));
  });

  it("falls back to ~/.config when XDG unset", () => {
    const p = configPath({});
    expect(p).toBe(path.join(os.homedir(), ".config", "workflow", "config.toml"));
  });
});

describe("resolveConfig — no file (byte-compat invariant)", () => {
  it("equals defaults() with every source 'default'", () => {
    const env = fakeHome(); // dir exists, but no config.toml inside
    const resolved = resolveConfig(env);
    expect(resolved.loaded).toBe(false);
    expect(resolved.config).toEqual(defaults());
    for (const source of Object.values(resolved.sources)) expect(source).toBe("default");
  });
});

describe("resolveConfig — user layer over defaults", () => {
  it("overrides only the keys present, flips their source to 'user'", () => {
    const env = fakeHome([
      'backend = "codex"',
      "concurrency = 8",
      "budget = 200000",
      'claude_bin = "/opt/claude"',
    ].join("\n"));
    const resolved = resolveConfig(env);
    const base = defaults();

    expect(resolved.loaded).toBe(true);
    expect(resolved.config.backend).toBe("codex");
    expect(resolved.config.concurrency).toBe(8);
    expect(resolved.config.budget).toBe(200000);
    expect(resolved.config.claudeBin).toBe("/opt/claude");
    // untouched keys keep the default value
    expect(resolved.config.model).toBe(base.model);
    expect(resolved.config.codexBin).toBe(base.codexBin);

    expect(resolved.sources.backend).toBe("user");
    expect(resolved.sources.concurrency).toBe("user");
    expect(resolved.sources.budget).toBe("user");
    expect(resolved.sources.claudeBin).toBe("user");
    expect(resolved.sources.model).toBe("default");
    expect(resolved.sources.codexBin).toBe("default");
  });

  it("accepts the camelCase bin spellings", () => {
    const env = fakeHome('codexBin = "/opt/codex"');
    expect(resolveConfig(env).config.codexBin).toBe("/opt/codex");
  });

  it("ignores unknown keys", () => {
    const env = fakeHome('nonsense = "ignored"\nbackend = "codex"');
    const resolved = resolveConfig(env);
    expect(resolved.config.backend).toBe("codex");
    // nothing leaks onto the config object
    expect((resolved.config as unknown as Record<string, unknown>).nonsense).toBeUndefined();
  });
});

describe("resolveConfig — validation", () => {
  it("rejects a non-positive concurrency", () => {
    const env = fakeHome("concurrency = 0");
    expect(() => resolveConfig(env)).toThrow(/concurrency/);
  });

  it("rejects a non-integer concurrency", () => {
    const env = fakeHome("concurrency = 2.5");
    expect(() => resolveConfig(env)).toThrow(/concurrency/);
  });

  it("rejects a non-positive budget", () => {
    const env = fakeHome("budget = -1");
    expect(() => resolveConfig(env)).toThrow(/budget/);
  });

  it("rejects a non-string backend", () => {
    const env = fakeHome("backend = 5");
    expect(() => resolveConfig(env)).toThrow(/backend/);
  });
});
