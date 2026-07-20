export const OUTPUT_LIMIT_BYTES = 1024 * 1024;
export const ERROR_CONTEXT_LIMIT_BYTES = 16 * 1024;

const TRUNCATION_MARKER = Buffer.from("\n... output truncated ...\n");
const TRUNCATION_MARKER_TEXT = TRUNCATION_MARKER.toString("utf8");

function prefixWithin(text: string, limit: number): string {
  let bytes = 0;
  let result = "";
  for (const character of text) {
    const size = Buffer.byteLength(character);
    if (bytes + size > limit) break;
    result += character;
    bytes += size;
  }
  return result;
}

function suffixWithin(text: string, limit: number): string {
  let bytes = 0;
  const result: string[] = [];
  const characters = Array.from(text);
  for (let index = characters.length - 1; index >= 0; index -= 1) {
    const character = characters[index]!;
    const size = Buffer.byteLength(character);
    if (bytes + size > limit) break;
    result.push(character);
    bytes += size;
  }
  return result.reverse().join("");
}

function truncateUtf8Text(text: string, limit: number): string {
  if (Buffer.byteLength(text) <= limit) return text;
  const contentLimit = limit - TRUNCATION_MARKER.length;
  const head = prefixWithin(text, Math.ceil(contentLimit / 2));
  const tail = suffixWithin(text, Math.floor(contentLimit / 2));
  return head + TRUNCATION_MARKER_TEXT + tail;
}

export interface BoundedText {
  text: string;
  bytes: number;
  truncated: boolean;
}

export class BoundedOutput {
  private readonly headLimit: number;
  private readonly tailLimit: number;
  private full = Buffer.alloc(0);
  private head = Buffer.alloc(0);
  private tail = Buffer.alloc(0);
  private totalBytes = 0;
  private truncated = false;

  constructor(private readonly limit = OUTPUT_LIMIT_BYTES) {
    if (!Number.isSafeInteger(limit) || limit <= TRUNCATION_MARKER.length) {
      throw new Error("output limit must be a safe integer larger than the truncation marker");
    }
    const contentLimit = limit - TRUNCATION_MARKER.length;
    this.headLimit = Math.ceil(contentLimit / 2);
    this.tailLimit = Math.floor(contentLimit / 2);
  }

  append(chunk: string | Buffer): void {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.totalBytes += value.length;

    if (!this.truncated) {
      const combined = Buffer.concat([this.full, value]);
      if (combined.length <= this.limit) {
        this.full = combined;
        return;
      }
      this.truncated = true;
      this.head = combined.subarray(0, this.headLimit);
      this.tail = combined.subarray(combined.length - this.tailLimit);
      this.full = Buffer.alloc(0);
      return;
    }

    if (this.tailLimit > 0) {
      const combined = Buffer.concat([this.tail, value]);
      this.tail = combined.subarray(Math.max(0, combined.length - this.tailLimit));
    }
  }

  value(): BoundedText {
    const bytes = this.totalBytes;
    if (!this.truncated) {
      const text = this.full.toString("utf8");
      const bounded = truncateUtf8Text(text, this.limit);
      return {
        text: bounded,
        bytes,
        truncated: bounded !== text,
      };
    }
    const text = Buffer.concat([this.head, TRUNCATION_MARKER, this.tail]).toString("utf8");
    return {
      text: truncateUtf8Text(text, this.limit),
      bytes,
      truncated: true,
    };
  }
}

export function boundText(text: string, limit = ERROR_CONTEXT_LIMIT_BYTES): string {
  const output = new BoundedOutput(limit);
  output.append(text);
  return output.value().text;
}

export function failureContext(stderr: string, stdout: string): string {
  const detail = stderr.trim() || stdout.trim();
  return detail ? boundText(detail) : "no process output";
}
