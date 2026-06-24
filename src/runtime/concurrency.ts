// Concurrency primitives.
//
// Byte-faithful to the monolith (`/Users/tom/cmptr/bin/workflow` ~39-66):
//   - `Semaphore`: a FIFO async limiter shared across ALL agent()/gate() calls in
//     a run. acquire() resolves immediately when under capacity, else queues a
//     resolver; release() pops the queue (FIFO) and hands the slot to the waiter.
//   - `defaultConcurrency`: Math.min(16, Math.max(2, cores - 2)) — the floor the
//     fidelity contract pins. Uses os.availableParallelism when present.
//
// No top-level await.

import os from "node:os";

/** Default agent concurrency: min(16, max(2, cores - 2)). Byte-identical to the
 * monolith's `defaultConcurrency` / `i0p`. */
export function defaultConcurrency(): number {
  const cores = (typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length) || 4;
  return Math.min(16, Math.max(2, cores - 2));
}

/** Shared async concurrency limiter (FIFO). Byte-identical to the monolith's
 * `Semaphore`: capacity floored at 1; acquire resolves now or queues; release
 * hands the freed slot to the head of the queue. */
export class Semaphore {
  max: number;
  active: number;
  queue: Array<() => void>;

  constructor(max: number) {
    this.max = Math.max(1, max);
    this.active = 0;
    this.queue = [];
  }

  acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.queue.push(resolve));
  }

  release(): void {
    this.active -= 1;
    const next = this.queue.shift();
    if (next) {
      this.active += 1;
      next();
    }
  }
}
