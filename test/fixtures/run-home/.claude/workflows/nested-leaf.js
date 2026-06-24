export const meta = {
  name: "nested-leaf",
  description: "Leaf workflow dispatched via workflow() from the runner fixture.",
  phases: [{ title: "Leaf" }],
};

phase("Leaf");
const echo = await agent(`leaf task: ${args && args.note ? args.note : "none"}`, { label: "leaf-agent" });
return { leaf: echo, gotArgs: args || null };
