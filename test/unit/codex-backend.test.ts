// Codex backend: engine-independent JSON-parse error text (Phase 4 parity).
//
// The monolith does a raw `JSON.parse(output)` on the codex result file and lets
// the engine's error propagate into the journal's `error` string. Under Bun that
// message diverges from Node's (e.g. "JSON Parse error: Unexpected EOF" vs
// "Unexpected end of JSON input"), which would break journal byte-parity with the
// node monolith on the parse-failure path (reproduced when a fake/real codex bin
// writes nothing to --output-last-message). codexBackend normalizes the empty-
// output case to V8's canonical text so the captured journal error is engine-
// independent. This test locks that.

import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { codexBackend } from "../../src/backends/codex.ts";
import type { Runtime } from "../../src/types.ts";

// A throwaway "codex" bin that honors --output-last-message but writes the given
// body to it (default: nothing -> empty file), exit 0. Mirrors how a real codex
// run can leave an empty result file.
function makeCodexBin(body: string): { bin: string; dir: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "codex-bin-"));
  const bin = path.join(dir, "fake-codex-empty.mjs");
  writeFileSync(
    bin,
    `#!/usr/bin/env node
import fs from "node:fs";
const argv = process.argv.slice(2);
const i = argv.indexOf("--output-last-message");
if (i !== -1) fs.writeFileSync(argv[i + 1], ${JSON.stringify(body)});
process.exit(0);
`,
  );
  chmodSync(bin, 0o755);
  return { bin, dir };
}

function runtimeFor(bin: string): Runtime {
  return {
    cwd: process.cwd(),
    backend: "codex",
    claudeBin: "claude",
    claudeArgs: [],
    claudeYolo: false,
    codexBin: bin,
    codexArgs: [],
    codexYolo: false,
    sandbox: undefined,
    model: undefined,
    concurrency: 1,
    budget: null,
    schemaRetries: 0,
    journalPath: null,
    resumeCache: new Map(),
    noValidate: false,
    verbose: false,
    vmTimeoutMs: 30000,
  };
}

const SCHEMA = { type: "object", properties: {}, additionalProperties: true };

describe("codexBackend JSON-parse error normalization", () => {
  it("empty result file throws V8's canonical 'Unexpected end of JSON input' (engine-independent)", async () => {
    const { bin, dir } = makeCodexBin("");
    try {
      let msg = "";
      try {
        await codexBackend("prompt", SCHEMA, runtimeFor(bin));
      } catch (e) {
        msg = (e as Error).message;
      }
      // The node monolith (V8) emits exactly this; the rewrite must match it
      // regardless of running under Bun.
      expect(msg).toBe("Unexpected end of JSON input");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("valid JSON output parses through unchanged", async () => {
    const { bin, dir } = makeCodexBin('{"approved":true}');
    try {
      const { value } = await codexBackend("prompt", SCHEMA, runtimeFor(bin));
      expect(value).toEqual({ approved: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
