export const meta = {
  name: "new-date-with-arg",
  description: "new Date(arg) is deterministic, so it is allowed; only argless new Date() is banned.",
  phases: [{ title: "Run" }],
};

const fixed = new Date("2020-01-01T00:00:00Z");
agent(String(fixed));
