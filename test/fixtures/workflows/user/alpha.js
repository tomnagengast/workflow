export const meta = {
  name: "alpha",
  description: "First   fixture   workflow with   collapsed whitespace.",
  phases: [{ title: "Plan" }, { title: "Build" }],
  // extra author keys must survive verbatim in the raw `meta` of list/show --json
  author: "fixture",
  tags: ["a", "b"],
};

// body is never executed by list/show (read-only). No mutating marker here, so
// the raw whole-file substring guard leaves this row unflagged.
agent("noop");
