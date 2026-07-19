export const meta = {
  name: "human-review",
  description: "Pause for human review.",
  phases: ["Review"],
  mutating: false,
};

phase("Review");
return gate("Should this workflow continue?", { reviewer: "human" });
