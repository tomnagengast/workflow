export const meta = {
  name: "runner-demo",
  description: "Exercises the full runner surface against fake backends: phase, log, agent, gate, parallel, pipeline, nested workflow(), and budget.",
  phases: [{ title: "Fan-out" }, { title: "Pipeline" }, { title: "Gate" }],
};

phase("Fan-out");
log(`budget total=${budget.total} remaining=${budget.remaining()}`);

// parallel(): barrier; a thrown thunk resolves to null (never rejects).
const fan = await parallel([
  () => agent("alpha task", { label: "alpha" }),
  () => agent("beta task", { label: "beta" }),
  () => { throw new Error("boom"); }, // -> null
]);

phase("Pipeline");
// pipeline(): per-item variadic stages, no barrier.
const piped = await pipeline(
  ["one", "two"],
  (item) => agent(`stage-1 ${item}`, { label: `s1-${item}` }),
  (prev, item) => agent(`stage-2 ${item}: ${prev}`, { label: `s2-${item}` }),
);

phase("Gate");
// gate(): always runs on the OPPOSITE backend; default GATE_SCHEMA -> object.
const verdict = await gate("approve the fan-out and pipeline output?");

// nested workflow(): shares this run's sem/budget/cache/journal.
const nested = await workflow("nested-leaf", { note: "from-runner-demo" });

return {
  fan: fan.filter(Boolean),
  fanNulls: fan.filter((x) => x === null).length,
  piped,
  verdictApproved: verdict && verdict.approved,
  nested,
  spent: budget.spent(),
};
