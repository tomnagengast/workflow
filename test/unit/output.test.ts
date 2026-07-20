import { describe, expect, it } from "bun:test";
import {
  BoundedOutput,
  ERROR_CONTEXT_LIMIT_BYTES,
  failureContext,
} from "../../src/runtime/output.ts";

describe("BoundedOutput", () => {
  it("preserves complete output within the limit", () => {
    const output = new BoundedOutput(128);
    output.append("hello ");
    output.append("world");
    expect(output.value()).toEqual({
      text: "hello world",
      bytes: 11,
      truncated: false,
    });
  });

  it("preserves the head and tail within a hard byte bound", () => {
    const output = new BoundedOutput(128);
    output.append("HEAD-" + "x".repeat(500) + "-TAIL");
    const value = output.value();
    expect(value.bytes).toBe(510);
    expect(value.truncated).toBe(true);
    expect(value.text).toStartWith("HEAD-");
    expect(value.text).toEndWith("-TAIL");
    expect(value.text).toContain("output truncated");
    expect(Buffer.byteLength(value.text)).toBeLessThanOrEqual(128);
  });

  it("keeps the encoded text bound for malformed UTF-8 bytes", () => {
    const output = new BoundedOutput(64);
    output.append(Buffer.alloc(100, 0xff));
    const value = output.value();
    expect(value.truncated).toBe(true);
    expect(Buffer.byteLength(value.text)).toBeLessThanOrEqual(64);
  });
});

describe("failureContext", () => {
  it("prefers stderr and keeps useful head and tail context", () => {
    const context = failureContext(
      "QUOTA-HEAD\n" + "x".repeat(ERROR_CONTEXT_LIMIT_BYTES * 2) + "\nQUOTA-TAIL",
      "unused stdout",
    );
    expect(context).toStartWith("QUOTA-HEAD");
    expect(context).toEndWith("QUOTA-TAIL");
    expect(context).toContain("output truncated");
    expect(Buffer.byteLength(context)).toBeLessThanOrEqual(ERROR_CONTEXT_LIMIT_BYTES);
  });

  it("falls back to stdout and then a stable empty marker", () => {
    expect(failureContext("", "stdout detail")).toBe("stdout detail");
    expect(failureContext("", "")).toBe("no process output");
  });
});
