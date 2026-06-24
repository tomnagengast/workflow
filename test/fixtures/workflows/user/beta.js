export const meta = {
  name: "beta",
  description: "Second fixture; phases given as bare strings.",
  phases: ["Scan", "Report"],
};

// This script mutates and is marked MUTATING, so the substring guard flags it.
// MUTATING
agent("noop");
