export const meta = {
  name: "human-parallel",
  description: "Suspend beside an active agent.",
  phases: ["Review"],
  mutating: false,
};

phase("Review");
return parallel([
  () => agent("Finish before suspension."),
  () => gate("Wait for a human.", { reviewer: "human" }),
]);
