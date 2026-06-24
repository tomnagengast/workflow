export const meta = {
  name: "date-now",
  description: "Calls Date.now() -> banned non-deterministic construct.",
  phases: [],
};
const t = Date.now();
agent(String(t));
