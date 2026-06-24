export const meta = {
  name: "top-level-return-await",
  description: "Body uses top-level return + await, legal under the async-IIFE wrap.",
  phases: [{ title: "Run" }],
};

// The runtime wraps the body in `(async () => { … })()`, so these are legal at
// execution time even though the file keeps its module-level export. The
// validator must NOT reject them.
const result = await agent("do the thing");
if (!result) return null;
for (const item of result) {
  await agent(item);
}
return result;
