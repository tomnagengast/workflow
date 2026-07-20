import { describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { claudeBackend } from "../../src/backends/claude.ts";
import type { Runtime } from "../../src/types.ts";

function runtimeFor(bin: string): Runtime {
  return {
    cwd: process.cwd(),
    backend: "claude",
    claudeBin: bin,
    claudeArgs: [],
    claudeYolo: false,
    codexBin: "codex",
    codexArgs: [],
    codexYolo: false,
    sandbox: undefined,
    model: undefined,
    concurrency: 1,
    budget: null,
    schemaRetries: 3,
    journalPath: null,
    resumeCache: new Map(),
    noValidate: false,
    verbose: false,
    vmTimeoutMs: 30000,
  };
}

describe("claudeBackend process failures", () => {
  it("does not retry a nonzero process and preserves stderr head and tail", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "claude-failure-"));
    const bin = path.join(dir, "failing-claude.mjs");
    const calls = path.join(dir, "calls.txt");
    try {
      writeFileSync(bin, `#!/usr/bin/env node
import fs from "node:fs";
fs.appendFileSync(${JSON.stringify(calls)}, "x");
process.stderr.write("QUOTA-HEAD\\n" + "x".repeat(40 * 1024) + "\\nQUOTA-TAIL");
process.exit(1);
`);
      chmodSync(bin, 0o755);
      await expect(claudeBackend(
        "prompt",
        { type: "object" },
        runtimeFor(bin),
      )).rejects.toThrow(/QUOTA-HEAD[\s\S]*QUOTA-TAIL/);
      expect(readFileSync(calls, "utf8")).toBe("x");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
