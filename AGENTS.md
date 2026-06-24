# Agent Context

`workflow` is a standalone runner for Claude Code "dynamic workflow" scripts
(`~/.claude/workflows/*.js` and project `.claude/workflows/*.js`). It discovers,
inspects, and executes those scripts against real `claude` / `codex` subagents,
outside an interactive Claude Code session. This repo is a Bun + TypeScript
rewrite of the legacy single-file Node runner at `/Users/tom/cmptr/bin/workflow`,
distributed as a single compiled binary via a Homebrew tap.

## Repository map

- `src/cli.ts` — CLI entrypoint and command dispatch. Load-bearing rule below.
- `src/version.ts` — version source of truth (`--define`-injectable at build).
- `src/types.ts` — shared type skeleton, grown as features land.
- `src/cli/` — arg parsing (frozen `parseOptions`), help text, terminal
  rendering, and `commands/{list,show,run}` (more land in later phases).
- `src/discovery/` — `catalog` (workflow dirs + git repo root + shadowing) and
  `resolve` (`NAME_RE` + `requireWorkflow`).
- `src/loader/` — `meta` (extract + vm-eval the `meta` literal), `validate`
  (size / meta-first / banned-token heuristic; real AST in Phase 6), and the
  frozen `transform` (export-strip + async-IIFE wrap).
- `src/runtime/` — the execution heart: `runner` (WorkflowRunner: agent / gate /
  parallel / pipeline / nested workflow / budget), `sandbox` (vm bag + run),
  `concurrency` (Semaphore + defaultConcurrency), `budget`, and the frozen
  `agentKey` (`v2:` hash) + `prompts` (prompt builders + `GATE_SCHEMA`).
- `src/backends/` — `claude` / `codex` agent backends, `spawn` (never-reject
  child process), and the `BACKENDS` registry + read-only PATH preflight.
- `src/schema/` — `tryParseJson` + `schemaOk` (structured-output helpers).
- `src/journal/` — `resume` (replay non-null results; writer lands Phase 4).
- `scripts/` — build / release tooling (`bun build --compile`).
- `test/` — `bun:test` unit, integration, characterization, compat suites.
- `dev/agent/` — stable non-interactive wrappers agents and CI both run.
- `docs/` — README index, install, getting-started, usage; deeper agent docs
  under `docs/agents/`.

The legacy monolith `/Users/tom/cmptr/bin/workflow` is the behavior **oracle**:
several modules must stay byte-identical to it. Do not "fix" its quirks.

## Golden-path commands

- `bun run dev -- <args>` — run the CLI from source.
- `bun run typecheck` — `tsc --noEmit`, the fastest meaningful check.
- `bun test` — the test suite.
- `bun run build` — compile the single-file binary.
- `dev/agent/check-fast` — typecheck + tests; the normal post-edit loop.
- `dev/agent/check-full` — check-fast plus a compile smoke.
- `dev/agent/dev-status` — report any running dev processes before starting one.
- `bun run context:check` — fail if agent docs / wrapper names have drifted.

## Safety rails

- **No top-level await on the load path.** The compiled binary uses CJS
  (`bun build --compile --bytecode`), which forbids TLA. Every module reachable
  from `src/cli.ts` must wrap async work in `async function main(){…}; main()`.
- **Frozen-byte modules** (agentKey `v2:` hash, prompt builders + `GATE_SCHEMA`,
  the export-strip/async-IIFE transform, jsonl `started`/`result` shapes, the
  `parseOptions` arg parser) must stay byte-identical to the monolith. Changing
  them breaks resume/journal portability.
- `gate()` is **always** injected into the sandbox (top-level and nested).
- Preserve current behavior, including quirks (e.g. `youtube-to-guide` mutates
  but lacks the `MUTATING` marker — do not "fix" the guard).
- Never commit secrets. Releases run unattended in CI; never publish locally.
- Clean up any process or worktree you start before ending a turn.

## What counts as done

A change is done when `dev/agent/check-fast` and `bun run context:check` exit 0,
and any behavior touching a frozen module still matches its golden test. Expand
to `dev/agent/check-full` for build- or release-sensitive surfaces.

## Maintaining context

When the repo shape, golden-path commands, wrapper names, or invariants change,
update this file (and the relevant `docs/agents/*.md`) in the **same** change.
`bun run context:check` enforces that the wrappers and docs named here exist.
