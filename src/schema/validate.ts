// Structured-output helpers:
//   - `tryParseJson`: pull the first JSON value out of an agent reply. Prefer a
//     ```json fenced``` block, else the raw text; find the first `{` or `[`
//     (whichever comes first), then trim trailing junk one char at a time until
//     JSON.parse succeeds. Returns null when nothing parses.
//   - `schemaOk`: a light JSON-Schema check (top-level type + required keys) — NOT
//     full AJV; just enough to drive the claude schema-retry loop.
//
// No top-level await.

/** Extract the first parseable JSON value from agent text. */
export function tryParseJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1]! : text;
  const start = candidate.indexOf("{");
  const startArr = candidate.indexOf("[");
  const from = startArr !== -1 && (start === -1 || startArr < start) ? startArr : start;
  if (from === -1) return null;
  for (let end = candidate.length; end > from; end -= 1) {
    try {
      return JSON.parse(candidate.slice(from, end));
    } catch {
      // keep trimming trailing junk
    }
  }
  return null;
}

/** Light top-level type and required-keys check. */
export function schemaOk(value: unknown, schema: unknown): boolean {
  if (!schema || typeof schema !== "object") return true;
  const s = schema as { type?: unknown; required?: unknown };
  if (s.type === "object" && (typeof value !== "object" || value === null || Array.isArray(value))) return false;
  if (s.type === "array" && !Array.isArray(value)) return false;
  if (Array.isArray(s.required)) {
    for (const key of s.required) {
      if (value == null || !(key in (value as object))) return false;
    }
  }
  return true;
}
