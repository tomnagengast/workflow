export const meta = {
  name: "math-random",
  description: "Calls Math.random() -> banned non-deterministic construct.",
  phases: [],
};
const r = Math.random();
agent(String(r));
