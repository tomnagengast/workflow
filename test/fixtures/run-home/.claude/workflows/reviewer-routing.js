export const meta = {
  name: "reviewer-routing",
  description: "Exercise explicit gate reviewer routing.",
  phases: ["Review"],
  mutating: false,
};

phase("Review");
const codex = await gate("Review with Codex.", { reviewer: "codex" });
const claude = await gate("Review with Claude.", { reviewer: "claude" });
return { codex, claude };
