export const meta = {
  name: "mutator",
  description: "MUTATING fixture: the raw whole-file substring scan flags this, so run refuses it without --allow-mutating.",
  phases: [{ title: "Mutate" }],
};

// The literal token MUTATING anywhere in the file trips the substring guard.
phase("Mutate");
return await agent("mutate the repo", { label: "mutator-agent" });
