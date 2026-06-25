export const meta = {
  name: "argless-new-date",
  description: "Constructs argless new Date() -> banned non-deterministic construct.",
  phases: [],
};
const now = new Date();
agent(String(now));
