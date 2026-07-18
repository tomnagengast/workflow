import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Journal, serializeJournalEvent, type JournalEventInput } from "../../src/journal/journal.ts";
import { loadResume } from "../../src/journal/resume.ts";

const started: JournalEventInput = {
  type: "step.started",
  workflow: "review",
  phase: "Research",
  stepId: 1,
  key: "v2:abc123",
  agentId: "researcher",
  backend: "codex",
  kind: "agent",
};
const completed: JournalEventInput = {
  ...started,
  type: "step.completed",
  result: { note: "ok", n: 7 },
  tokens: 12,
};
const failed: JournalEventInput = {
  ...started,
  type: "step.failed",
  stepId: 2,
  key: "v2:def456",
  result: null,
  error: "spawn failed",
};

describe("semantic journal", () => {
  it("serializes one event per JSONL line", () => {
    expect(serializeJournalEvent({
      sequence: 1,
      at: "2026-07-17T12:00:00.000Z",
      ...started,
    })).toBe(
      '{"sequence":1,"at":"2026-07-17T12:00:00.000Z","type":"step.started","workflow":"review","phase":"Research","stepId":1,"key":"v2:abc123","agentId":"researcher","backend":"codex","kind":"agent"}\n',
    );
  });

  it("durably appends events with contiguous sequence numbers", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "wf-journal-"));
    const file = path.join(dir, "j.jsonl");
    const times = [
      new Date("2026-07-17T12:00:00.000Z"),
      new Date("2026-07-17T12:00:01.000Z"),
      new Date("2026-07-17T12:00:02.000Z"),
    ];
    try {
      const journal = new Journal(file, () => times.shift()!);
      journal.write(started);
      journal.write(completed);
      journal.write(failed);
      const events = readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      expect(events.map((event) => event.sequence)).toEqual([1, 2, 3]);
      expect(events.map((event) => event.at)).toEqual([
        "2026-07-17T12:00:00.000Z",
        "2026-07-17T12:00:01.000Z",
        "2026-07-17T12:00:02.000Z",
      ]);
      expect(events.map((event) => event.type)).toEqual([
        "step.started",
        "step.completed",
        "step.failed",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("accepts a null path as an observation-only sink", () => {
    const journal = new Journal(null);
    expect(journal.write(started).sequence).toBe(1);
  });
});

describe("journal resume", () => {
  it("replays successful agent results but not failures or nested workflows", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "wf-journal-"));
    const file = path.join(dir, "j.jsonl");
    try {
      const journal = new Journal(file);
      journal.write(started);
      journal.write(completed);
      journal.write(failed);
      journal.write({
        type: "step.completed",
        workflow: "child",
        kind: "workflow",
        key: "nested",
        result: "done",
      });

      const cache = loadResume(file);
      expect([...cache]).toEqual([["v2:abc123", { note: "ok", n: 7 }]]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
