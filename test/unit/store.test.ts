// Unit — auto-journal store (journal/store.ts).
//
// Covers the state-dir resolution ($XDG_STATE_HOME override + ~/.local/state
// fallback), the per-run journal path (sanitized name, unique, dir created), and
// "last = newest mtime" resolution incl. the empty/missing-dir cases.

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { stateDir, newJournalPath, lastJournalPath } from "../../src/journal/store.ts";

describe("stateDir", () => {
  it("honors $XDG_STATE_HOME", () => {
    expect(stateDir({ XDG_STATE_HOME: "/tmp/xs" })).toBe(path.join("/tmp/xs", "workflow"));
  });

  it("falls back to ~/.local/state when XDG_STATE_HOME is unset/blank", () => {
    const expected = path.join(os.homedir(), ".local", "state", "workflow");
    expect(stateDir({})).toBe(expected);
    expect(stateDir({ XDG_STATE_HOME: "   " })).toBe(expected);
  });
});

describe("newJournalPath", () => {
  let base: string;
  beforeEach(() => {
    base = mkdtempSync(path.join(os.tmpdir(), "wf-store-"));
  });
  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it("creates the state dir and returns an absolute .jsonl path under it", () => {
    const env = { XDG_STATE_HOME: base };
    const p = newJournalPath("my-flow", env);
    expect(existsSync(path.join(base, "workflow"))).toBe(true);
    expect(path.isAbsolute(p)).toBe(true);
    expect(path.dirname(p)).toBe(path.join(base, "workflow"));
    expect(p.endsWith(".jsonl")).toBe(true);
    expect(p).toContain("my-flow");
  });

  it("sanitizes unsafe characters in the workflow name", () => {
    const p = newJournalPath("a/b c:d", { XDG_STATE_HOME: base });
    expect(path.basename(p)).not.toContain("/");
    expect(path.basename(p)).toContain("a-b-c-d");
  });

  it("falls back to 'run' for an empty name", () => {
    const p = newJournalPath("", { XDG_STATE_HOME: base });
    expect(path.basename(p)).toContain("run");
  });

  it("produces distinct paths for distinct timestamps", () => {
    const env = { XDG_STATE_HOME: base };
    const a = newJournalPath("x", env, 1_000);
    const b = newJournalPath("x", env, 2_000);
    expect(a).not.toBe(b);
  });
});

describe("lastJournalPath", () => {
  let base: string;
  beforeEach(() => {
    base = mkdtempSync(path.join(os.tmpdir(), "wf-store-"));
  });
  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it("returns null when the state dir does not exist", () => {
    expect(lastJournalPath({ XDG_STATE_HOME: base })).toBeNull();
  });

  it("returns null when the dir has no .jsonl files", () => {
    const dir = path.join(base, "workflow");
    newJournalPath("seed", { XDG_STATE_HOME: base }); // creates the dir
    writeFileSync(path.join(dir, "notes.txt"), "ignore me");
    expect(lastJournalPath({ XDG_STATE_HOME: base })).toBeNull();
  });

  it("resolves the newest .jsonl by mtime", () => {
    const env = { XDG_STATE_HOME: base };
    const older = newJournalPath("old", env, 1_000);
    const newer = newJournalPath("new", env, 2_000);
    writeFileSync(older, "{}\n");
    writeFileSync(newer, "{}\n");
    // force a clear mtime ordering regardless of write timing
    utimesSync(older, new Date(1_000), new Date(1_000));
    utimesSync(newer, new Date(2_000), new Date(2_000));
    expect(statSync(newer).mtimeMs).toBeGreaterThan(statSync(older).mtimeMs);
    expect(lastJournalPath(env)).toBe(newer);
  });
});
