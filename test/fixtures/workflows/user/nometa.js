// No `export const meta` literal: discovery must synthesize the default row
// (name from filename, empty description, empty phases) — byte-faithful to the
// monolith's parseWorkflow fallback.
agent("noop");
