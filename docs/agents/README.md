# Agent docs index

Progressive-disclosure entry point for agents working in this repo. Start at the
root [`AGENTS.md`](../../AGENTS.md) for product shape, the repo map, golden-path
commands, and safety rails. Read deeper here only for the surface you are
touching.

## Where to read next

- **Product / behavior contract** — this repository is the sole contract.
  Snapshots and golden tests lock the agentKey hash, prompt builders,
  export-strip/async-IIFE transform, `parseOptions` parser, CLI output, and
  complete semantic journal documented in [`../usage.md`](../usage.md).
- **Build / runtime constraint** — the compiled binary is CJS
  (`bun build --compile --bytecode`), so there is no top-level await on the load
  path. Wrap async work in `async function main(){…}; main()`.
- **Install** — [`../install.md`](../install.md).
- **Getting started** — [`../getting-started.md`](../getting-started.md).
- **Usage** — [`../usage.md`](../usage.md).

These docs are stubs filled in as the matching features land (install/usage
become real around the release phase; a config guide is earned once layered
config ships). Keep them and the root `AGENTS.md` in sync in the same change that
shifts the repo's shape — `bun run context:check` enforces the named wrappers and
docs exist.
