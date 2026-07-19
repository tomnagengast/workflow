# workflow

**Run your Claude Code dynamic workflows from the terminal, against real agents — no interactive session required.**

> Status: pre-1.0, in active rewrite. Bun + TypeScript, shipped as a single binary.

Claude Code's "dynamic workflows" are JavaScript scripts in `~/.claude/workflows`
(and project `.claude/workflows`) that orchestrate fan-out subagents, gates, and
pipelines. `workflow` discovers, inspects, and runs those same scripts as a
standalone CLI, dispatching to real `claude` or `codex` backends.

```
$ workflow list
$ workflow run adversarial-pr-gate --args '{"diff":"git diff HEAD~1 HEAD"}'
$ workflow --cwd /path/to/project run /path/to/workflow.js
```

## Who it's for

Anyone with Claude Code workflow scripts who wants to run them outside an
interactive session — in a shell, a script, or CI.

## Install

Homebrew:

```
brew tap tomnagengast/tap
brew install --cask workflow-cli
```

From source (Bun required):

```
bun run dev -- list
```

See [`docs/install.md`](docs/install.md). `claude` and/or `codex` are runtime
prerequisites and must be on your `PATH`.

## First command

```
workflow --version
workflow list
```

## Why this exists

The dynamic-workflow runtime is normally reachable only inside an interactive
Claude Code session. `workflow` reimplements that runtime contract as a portable,
scriptable binary with the same loader, sandbox, and prompts, plus a complete
semantic event journal, so the workflows you already have become composable
command-line tools.

## Status

Pre-1.0. The CLI surface and behavior are being rebuilt phase by phase against
the legacy runner as a behavior oracle. Expect rough edges until the first
tagged release.

## Docs

See [`docs/README.md`](docs/README.md): [install](docs/install.md),
[getting started](docs/getting-started.md), [usage](docs/usage.md). Agents start
at [`AGENTS.md`](AGENTS.md).
