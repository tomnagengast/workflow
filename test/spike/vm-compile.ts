// Phase 1 spike — THE GATE.
//
// Proves the load-bearing runtime assumption before any real code is written:
// `node:vm` (createContext + runInContext, async-IIFE body, `timeout` option,
// an injected async global) works inside a `bun build --compile --bytecode`
// binary. This mirrors the monolith's real execution shape
// (/Users/tom/cmptr/bin/workflow ~536-562): strip the `export` off
// `export const meta`, wrap the body in `(async () => { ... })()`, then
// runInContext with { filename, timeout } against a context bag that carries
// an injected async dispatch function.
//
// HARD CONSTRAINT: no top-level await anywhere on this load path. `--bytecode`
// forces CJS, which forbids TLA. All async work lives inside main(); main()
// is called at the bottom with .then/.catch, never awaited at module scope.

import vm from "node:vm";

// A tiny "workflow body" in the monolith's authored shape: starts with
// `export const meta = {...}`, then calls an injected async global.
const WORKFLOW_BODY = `export const meta = { name: "spike", description: "vm gate" };
const a = await dispatch("alpha");
const b = await dispatch("beta");
return { meta, joined: a + "+" + b };`;

const EXPORT_META = "export const meta";

function stripExportAndWrap(source: string): string {
  // Mirror the monolith: drop the `export` keyword so `const meta = {...}`
  // stays a normal declaration, then wrap the whole body in an async IIFE.
  const idx = source.indexOf(EXPORT_META);
  if (idx === -1) throw new Error("spike body must start with `export const meta`");
  const transformed =
    source.slice(0, idx) + "const meta" + source.slice(idx + EXPORT_META.length);
  return `(async () => {\n${transformed}\n})()`;
}

async function main(): Promise<void> {
  const wrapped = stripExportAndWrap(WORKFLOW_BODY);

  // Injected async global — the thing agent()/gate() are in the real runner.
  const context = vm.createContext({
    console,
    JSON,
    dispatch: async (name: string): Promise<string> => {
      // force a real microtask hop so we exercise async-in-vm, not a sync fake
      await Promise.resolve();
      return `dispatched:${name}`;
    },
  });

  const result = await vm.runInContext(wrapped, context, {
    filename: "spike://vm-compile",
    timeout: 5000,
  });

  const expected = "dispatched:alpha+dispatched:beta";
  if (!result || typeof result !== "object" || result.joined !== expected) {
    console.error("[spike] FAIL: unexpected vm result:", JSON.stringify(result));
    process.exit(1);
  }
  if (!result.meta || result.meta.name !== "spike") {
    console.error("[spike] FAIL: meta not threaded through vm:", JSON.stringify(result));
    process.exit(1);
  }

  // The gate's success signal: print the dispatched async result.
  console.log(result.joined);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[spike] FAIL:", error);
    process.exit(1);
  });
