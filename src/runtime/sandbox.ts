// Both top-level and nested workflows receive the same vm global surface. This
// module centralizes:
//   - `buildSandboxBag`: assemble the global object exposed to a workflow body
//     (args, console, JSON, Math, Date — Math.random/Date present-but-parse-
//     banned — budget, phase, log, agent, gate, action, parallel, pipeline,
//     workflow, setTimeout, clearTimeout). `gate` and `action` are ALWAYS
//     injected (top-level AND nested).
//   - `runInSandbox`: createContext + runInContext with `{ filename, timeout }`.
//
// `node:vm` works under `bun build --compile --bytecode` (proven Phase 1). No top-
// level await.

import vm from "node:vm";
import type { Budget } from "./budget.ts";

/** The set of host hooks a sandbox bag wires to the runner. */
export interface SandboxHooks {
  args: unknown;
  budget: Budget;
  phase: (title: unknown) => void;
  log: (message: unknown) => void;
  agent: (prompt: string, opts?: Record<string, unknown>) => Promise<unknown>;
  gate: (prompt: string, opts?: Record<string, unknown>) => Promise<unknown>;
  action: (spec: unknown) => Promise<unknown>;
  parallel: (thunks: unknown) => Promise<unknown>;
  pipeline: (items: unknown[], ...stages: unknown[]) => Promise<unknown>;
  workflow: (nameOrSpec: unknown, nestedArgs?: unknown) => Promise<unknown>;
}

/** Build the global bag injected into the vm context. */
export function buildSandboxBag(hooks: SandboxHooks): Record<string, unknown> {
  return {
    args: hooks.args,
    console,
    JSON,
    Math, // Math.random is parse-banned, not removed
    Date, // Date.now()/new Date() are parse-banned, not removed
    budget: hooks.budget,
    phase: hooks.phase,
    log: hooks.log,
    agent: hooks.agent,
    gate: hooks.gate,
    action: hooks.action,
    parallel: hooks.parallel,
    pipeline: hooks.pipeline,
    workflow: hooks.workflow,
    setTimeout,
    clearTimeout,
  };
}

/** Run transformed source in a fresh context and return the IIFE result. */
export function runInSandbox(
  wrapped: string,
  bag: Record<string, unknown>,
  filename: string,
  timeoutMs: number,
): unknown {
  const context = vm.createContext(bag);
  return vm.runInContext(wrapped, context, { filename, timeout: timeoutMs });
}
