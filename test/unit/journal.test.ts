// FROZEN journal-shape golden test.
//
// Locks the on-disk jsonl bytes of the `started`/`result` events against the
// monolith's inline writer (`/Users/tom/cmptr/bin/workflow` ~516-518, 589, 596,
// 600). These bytes are load-bearing for resume + cross-run portability: the
// field NAMES, ORDER, and `JSON.stringify` serialization must not drift, or
// `loadResume` (and the Phase 8 auto-journal) silently break. The expected
// strings below are the literal lines the monolith emits.

import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Journal, serializeJournalEvent, type JournalEvent } from "../../src/journal/journal.ts";
import { loadResume } from "../../src/journal/resume.ts";

// The three event variants the runner's _dispatch emits, with realistic field
// values (an agentKey-shaped `key`, a `result` object, an `error` string).
const startedEvent: JournalEvent = {
  type: "started",
  key: "v2:abc123",
  agentId: "researcher",
  backend: "claude",
  kind: "agent",
};
const resultEvent: JournalEvent = {
  type: "result",
  key: "v2:abc123",
  agentId: "researcher",
  backend: "claude",
  kind: "agent",
  result: { note: "ok", n: 7 },
};
const errorEvent: JournalEvent = {
  type: "result",
  key: "v2:def456",
  agentId: "gate",
  backend: "codex",
  kind: "gate",
  result: null,
  error: "spawn failed",
};

describe("journal frozen byte-shape", () => {
  it("serializes `started` to the monolith's exact line", () => {
    expect(serializeJournalEvent(startedEvent)).toBe(
      '{"type":"started","key":"v2:abc123","agentId":"researcher","backend":"claude","kind":"agent"}\n',
    );
  });

  it("serializes a successful `result` to the monolith's exact line", () => {
    expect(serializeJournalEvent(resultEvent)).toBe(
      '{"type":"result","key":"v2:abc123","agentId":"researcher","backend":"claude","kind":"agent","result":{"note":"ok","n":7}}\n',
    );
  });

  it("serializes a failed `result` (result:null + error) to the monolith's exact line", () => {
    expect(serializeJournalEvent(errorEvent)).toBe(
      '{"type":"result","key":"v2:def456","agentId":"gate","backend":"codex","kind":"gate","result":null,"error":"spawn failed"}\n',
    );
  });
});

describe("Journal append writer", () => {
  it("appends each event as one jsonl line, in order", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "wf-journal-"));
    const file = path.join(dir, "j.jsonl");
    try {
      const j = new Journal(file);
      j.write(startedEvent);
      j.write(resultEvent);
      j.write(errorEvent);
      await j.end(); // flush the stream before reading
      const lines = readFileSync(file, "utf8");
      expect(lines).toBe(
        serializeJournalEvent(startedEvent) +
          serializeJournalEvent(resultEvent) +
          serializeJournalEvent(errorEvent),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a null path is a no-op sink (write/end do not throw)", () => {
    const j = new Journal(null);
    expect(() => {
      j.write(startedEvent);
      j.end();
    }).not.toThrow();
  });
});

describe("journal <-> resume round-trip", () => {
  it("loadResume replays only non-null `result` events, keyed by `key`", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "wf-journal-"));
    const file = path.join(dir, "j.jsonl");
    try {
      const j = new Journal(file);
      j.write(startedEvent); // not a result -> skipped on replay
      j.write(resultEvent); // non-null result -> cached
      j.write(errorEvent); // result:null -> skipped (must re-dispatch)
      await j.end(); // flush the stream before replaying

      const cache = loadResume(file);
      expect(cache.size).toBe(1);
      expect(cache.has("v2:abc123")).toBe(true);
      expect(cache.get("v2:abc123")).toEqual({ note: "ok", n: 7 });
      expect(cache.has("v2:def456")).toBe(false); // the failed gate is NOT cached
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
