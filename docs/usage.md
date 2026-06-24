# Usage

> Stub — kept in sync with `workflow --help` as commands land.

```
workflow [--cwd DIR] <command> [options]
```

## Global

- `--cwd DIR` — resolve workflows and run from `DIR`.
- `-h`, `--help` — print usage.
- `-v`, `--version` — print the version.

## Commands

- `list [--json]` — list resolved workflows.
- `show <name> [--json]` — show a workflow's metadata.
- `run <name> [--args JSON|@file]` — run a workflow against real subagents.

Run `workflow --help` for the full, current option set (backend, concurrency,
budget, journaling, and backend-specific flags). This document tracks that help
text as each command is implemented.
