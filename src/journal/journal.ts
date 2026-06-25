// Journal writer (jsonl) — FROZEN event shapes.
//
// Byte-faithful to the monolith's inline journal writer (`/Users/tom/cmptr/bin/
// workflow` ~513-518, ~589, ~596, ~600): an APPEND-mode jsonl stream that writes
// one `JSON.stringify(event) + "\n"` per dispatch. There are exactly two event
// types, emitted by `_dispatch` in the runner:
//
//   started: { type:"started", key, agentId, backend, kind }
//   result:  { type:"result",  key, agentId, backend, kind, result }            (success)
//   result:  { type:"result",  key, agentId, backend, kind, result:null, error } (subagent died)
//
// These bytes are LOAD-BEARING: `loadResume` (journal/resume.ts) replays only
// `result` events whose `result` is non-null and which carry a `key`, so any
// drift in field names/order/serialization silently breaks resume + cross-run
// portability (manual `--journal` AND the Phase 8 auto-journal both read these).
// The golden test in test/unit/journal.test.ts freezes the serialized bytes.
//
// No top-level await: this is a plain class with synchronous stream writes.

import fs from "node:fs";

/** Event keys, in monolith insertion order. `result`/`error` are optional so the
 * same record type covers both `started` and the two `result` variants. The
 * field ORDER here is the serialization order `JSON.stringify` emits — keep it. */
export interface JournalEvent {
  type: "started" | "result";
  key: string;
  agentId: string;
  backend: string;
  kind: string;
  result?: unknown;
  error?: string;
}

/** Append-mode jsonl journal. Byte-identical to the monolith's inline writer:
 * `fs.createWriteStream(path, { flags: "a" })`, each event serialized as
 * `JSON.stringify(event) + "\n"`. A null path => a no-op sink (the monolith's
 * `this.journalStream = null` branch) so the runner can call `.journal()`
 * unconditionally. */
export class Journal {
  private stream: fs.WriteStream | null;

  constructor(journalPath: string | null) {
    this.stream = journalPath ? fs.createWriteStream(journalPath, { flags: "a" }) : null;
  }

  /** Write one event line. No-op when there is no journal path. */
  write(event: JournalEvent): void {
    if (this.stream) this.stream.write(JSON.stringify(event) + "\n");
  }

  /** Close the underlying stream (called in the runner's `finally`). Resolves
   * once the stream has flushed and emitted `finish`; resolves immediately when
   * there is no journal path. The runner calls this fire-and-forget like the
   * monolith's `this.journalStream.end()`, but returning the promise lets a
   * caller (e.g. a test, or a future awaited shutdown) wait for the flush. */
  end(): Promise<void> {
    const stream = this.stream;
    if (!stream) return Promise.resolve();
    return new Promise((resolve) => {
      stream.end(() => resolve());
    });
  }
}

/** Serialize a single journal event to its on-disk line (including the trailing
 * newline). Exposed so the golden test can assert the FROZEN bytes without
 * touching the filesystem, and so the Phase 8 auto-journal can reuse the exact
 * same shape. */
export function serializeJournalEvent(event: JournalEvent): string {
  return JSON.stringify(event) + "\n";
}
