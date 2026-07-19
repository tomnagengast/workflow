// Semaphore capacity, FIFO release order, and default concurrency floor.

import { describe, expect, it } from "bun:test";
import { Semaphore, defaultConcurrency } from "../../src/runtime/concurrency.ts";

describe("Semaphore", () => {
  it("caps active acquisitions and queues the rest", async () => {
    const sem = new Semaphore(2);
    await sem.acquire();
    await sem.acquire();
    expect(sem.active).toBe(2);
    let third = false;
    const p = sem.acquire().then(() => { third = true; });
    await Promise.resolve();
    expect(third).toBe(false); // queued, not granted
    sem.release();
    await p;
    expect(third).toBe(true);
  });

  it("releases in FIFO order", async () => {
    const sem = new Semaphore(1);
    await sem.acquire(); // hold the only slot
    const order: number[] = [];
    const a = sem.acquire().then(() => order.push(1));
    const b = sem.acquire().then(() => order.push(2));
    const c = sem.acquire().then(() => order.push(3));
    sem.release();
    await a;
    sem.release();
    await b;
    sem.release();
    await c;
    expect(order).toEqual([1, 2, 3]);
  });

  it("floors capacity at 1", async () => {
    const sem = new Semaphore(0);
    expect(sem.max).toBe(1);
  });
});

describe("defaultConcurrency", () => {
  it("stays within the min(16, max(2, cores-2)) floor/ceiling", () => {
    const c = defaultConcurrency();
    expect(c).toBeGreaterThanOrEqual(2);
    expect(c).toBeLessThanOrEqual(16);
  });
});
