import { appendFileSync, existsSync, readFileSync } from "node:fs";

export const JOURNAL_EVENT_TYPES = [
  "runtime.started",
  "runtime.resumed",
  "phase.started",
  "log",
  "diagnostic",
  "step.started",
  "step.cached",
  "step.completed",
  "step.failed",
  "runtime.suspended",
  "runtime.completed",
  "runtime.failed",
] as const;

export type JournalEventType = (typeof JOURNAL_EVENT_TYPES)[number];

/** One semantic runtime observation. Sequence is the authoritative order for a
 * run; `at` records when the workflow process observed it. */
export interface JournalEvent {
  sequence: number;
  at: string;
  type: JournalEventType;
  workflow: string;
  phase?: string;
  stepId?: number;
  key?: string;
  agentId?: string;
  backend?: string;
  kind?: string;
  message?: string;
  schema?: unknown;
  result?: unknown;
  error?: string;
  tokens?: number;
  concurrency?: number;
  budget?: number | null;
}

export type JournalEventInput = Omit<JournalEvent, "sequence" | "at">;

/** Append one semantic event before workflow execution continues. */
export class Journal {
  private sequence = 0;

  constructor(
    private readonly journalPath: string | null,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (journalPath && existsSync(journalPath)) {
      const lines = readFileSync(journalPath, "utf8").split("\n").filter(Boolean);
      for (const line of lines) {
        const event = JSON.parse(line) as { sequence?: unknown };
        if (!Number.isInteger(event.sequence) || Number(event.sequence) <= this.sequence) {
          throw new Error(`Journal has invalid sequence at ${journalPath}`);
        }
        this.sequence = Number(event.sequence);
      }
    }
  }

  get continued(): boolean {
    return this.sequence > 0;
  }

  write(input: JournalEventInput): JournalEvent {
    const event: JournalEvent = {
      sequence: ++this.sequence,
      at: this.now().toISOString(),
      ...input,
    };
    if (this.journalPath) appendFileSync(this.journalPath, serializeJournalEvent(event));
    return event;
  }

  end(): Promise<void> {
    return Promise.resolve();
  }
}

export function serializeJournalEvent(event: JournalEvent): string {
  return JSON.stringify(event) + "\n";
}
