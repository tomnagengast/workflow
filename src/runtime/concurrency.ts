// Concurrency primitives:
//   - `Semaphore`: a FIFO async limiter shared across ALL agent(), gate(), and
//     action() calls in a run. acquire() resolves immediately when under
//     capacity, else queues a resolver; release() pops the queue (FIFO) and
//     hands the slot to the waiter.
//   - `defaultConcurrency`: Math.min(16, Math.max(2, cores - 2)) — the floor the
//     configured default. Uses os.availableParallelism when present.
//
// No top-level await.

import os from "node:os";

/** Default agent concurrency: min(16, max(2, cores - 2)). */
export function defaultConcurrency(): number {
  const cores = (typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length) || 4;
  return Math.min(16, Math.max(2, cores - 2));
}

/** Shared FIFO limiter with capacity floored at one and abortable waiters. */
export class Semaphore {
  max: number;
  active: number;
  queue: Array<{
    resolve: () => void;
    reject: (error: unknown) => void;
    signal?: AbortSignal;
    onAbort?: () => void;
  }>;

  constructor(max: number) {
    this.max = Math.max(1, max);
    this.active = 0;
    this.queue = [];
  }

  acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      return Promise.reject(signal.reason ?? new Error("operation cancelled"));
    }
    if (this.active < this.max) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const waiter: {
        resolve: () => void;
        reject: (error: unknown) => void;
        signal?: AbortSignal;
        onAbort?: () => void;
      } = { resolve, reject, signal };
      if (signal) {
        waiter.onAbort = () => {
          const index = this.queue.indexOf(waiter);
          if (index >= 0) this.queue.splice(index, 1);
          reject(signal.reason ?? new Error("operation cancelled"));
        };
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      this.queue.push(waiter);
    });
  }

  release(): void {
    this.active -= 1;
    const next = this.queue.shift();
    if (next) {
      if (next.signal && next.onAbort) {
        next.signal.removeEventListener("abort", next.onAbort);
      }
      this.active += 1;
      next.resolve();
    }
  }
}
