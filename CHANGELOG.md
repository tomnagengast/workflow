# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and this project aims to follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.0.6] - 2026-07-19

### Added

- `gate(prompt, { reviewer })` now accepts `agent`, `codex`, `claude`, or
  `human`. The default `agent` route keeps the existing opposite-backend
  review, while an explicit backend pins the reviewer.
- Human gates record `runtime.suspended` and exit with status 75. Appending the
  matching `step.completed` result to the journal and rerunning with that file
  as both `--journal` and `--resume` continues the same ordered stream with
  `runtime.resumed`.

## [0.0.5] - 2026-07-19

### Changed

- Removed the external test dependency. The public CLI and its committed
  snapshots and golden tests now define the full contract.
- Listed `workflow validate <name|path>` in the normal CLI help and documented
  its read-only loader checks.

## [0.0.4] - 2026-07-18

### Added

- `workflow run` accepts an explicit workflow file while `--cwd` independently
  controls the working directory used by agent backends.

## [0.0.3] - 2026-07-18

### Fixed

- Kept `--model` scoped to the selected backend so cross-model gates use the
  opposite backend's default model instead of receiving an invalid
  provider-specific model name.

## [0.0.2] - 2026-07-17

### Changed

- Replaced the dispatch-only journal with a complete ordered semantic event
  stream covering runtime lifecycle, phases, logs, diagnostics, agent and gate
  steps, cache hits, nested workflows, results, and failures.
- Resume runs now journal cache hits, preserving both observability and the
  ability to resume from a resumed run.
- Fixed the CI release smoke to render the Homebrew cask through the published
  `release:cask` command.

## [0.0.1] - 2026-06-24

First release of the Bun + TypeScript standalone workflow runner,
distributed as prebuilt single-file binaries through a Homebrew tap.

### Added

- Repo skeleton for the Bun + TypeScript CLI: build/lang config, CLI
  entrypoint stub, agent-readiness floor (`AGENTS.md`, `CLAUDE.md` shim,
  `docs/agents/`, `dev/agent/` wrappers, `context:check`), and starter docs.
- `workflow --version` / `-v` — prints the version.
- `workflow list` / `workflow show <name>` — real read-only discovery against
  `~/.claude/workflows` + project `.claude/workflows`, with scope shadowing and
  meta-first parsing. `--json` carries the raw, un-flattened `meta` verbatim.
- `workflow run <name>` — execute a workflow end-to-end in a `node:vm` sandbox
  against the `claude` / `codex` agent backends. Full `agent` / `gate` /
  `parallel` / `pipeline` / `phase` / `budget` / nested `workflow()` dispatch,
  the shared FIFO concurrency limiter, the resume cache, and the started/result
  journal. Frozen modules
  (`agentKey` `v2:` hash, the prompt builders + `GATE_SCHEMA`, the
  export-strip/async-IIFE transform, the `parseOptions` table) are locked by
  golden tests. `gate()` always runs on the opposite backend and is always
  injected into the sandbox (top-level and nested).
- `workflow run --journal <file>` / `--resume <file>` — the started/result jsonl
  writer is a frozen `journal/journal.ts` module with byte-stable event shapes,
  append mode), locked by a golden-bytes test. `--resume` replays a prior
  journal's non-null results from cache without re-dispatching.
- Homebrew release pipeline (`.github/workflows/release.yml`): a `v*.*.*` tag
  cross-compiles four single-file binaries (`darwin-arm64`, Intel-baseline
  `darwin-x64`, `linux-x64`, `linux-arm64`) from one host, ad-hoc codesigns the
  darwin artifacts, packages them as `workflow_<ver>_<os>_<arch>.tar.gz`,
  publishes a GitHub Release with checksums, and renders + pushes the
  `workflow-cli` cask to the shared `tomnagengast/homebrew-tap`. The pre-publish
  signing / Gatekeeper launch test (`bun run release:dry-run`) runs on every PR
  (`release-dry-run` CI job) so a SIGKILL (exit 137) or broken cross-compile is
  caught without cutting a release. Maintainer guide: `docs/release.md`.
- `workflow validate <name|path>` — standalone loader validation backed by a real
  AST parse: asserts `export const meta`
  is the first statement and a literal, rejects `Date.now()` / `Math.random()` /
  argless `new Date()` by node type, and enforces the 512 KiB source cap.
- `workflow doctor` — environment diagnostics: backend (`claude` / `codex`)
  presence on `PATH`, discovery-root realpath resolution and scope shadowing, and
  the live catalog count.
- `workflow config` + layered configuration (`flags > user > defaults`): an
  optional TOML user config (`~/.config/workflow/config.toml`) supplies defaults
  for backend / model / concurrency / budget / bins under explicit flags.
- `workflow run --resume-last` + minimal auto-journal: runs auto-journal to a
  state dir (`$XDG_STATE_HOME` or `~/.local/state/workflow/`) using the same
  frozen jsonl shapes, so the last run is replayable and cross-compatible with
  manual `--journal` files.
