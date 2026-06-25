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
- `resume --last <name> [run options]` — replay the most recent run of `<name>`
  (sugar for `run <name> --resume-last`).

Run `workflow --help` for the full, current option set (backend, concurrency,
budget, journaling, and backend-specific flags). This document tracks that help
text as each command is implemented.

## Journaling & resume

Every `run` writes a journal of its subagent dispatches. Each line is one JSON
event (`started` / `result`) — the same shape whether the file is auto-written
or explicitly placed with `--journal`, so the two are interchangeable.

- **Auto-journal (default on):** with no `--journal`, each run journals to a
  fresh per-run file under the state dir — `$XDG_STATE_HOME/workflow/` if set,
  else `~/.local/state/workflow/`. This is a new on-disk side effect the older
  tool did not have. There is no index or automatic cleanup yet; files
  accumulate until you remove them.
- **`--journal FILE`:** journal to an explicit path instead of the state dir.
- **`--resume FILE`:** replay cached `agent()`/`gate()` results from a prior
  journal, skipping any dispatch whose result was already recorded.
- **`--resume-last` (or `resume --last <name>`):** replay the newest auto-journal
  in the state dir (resolved by modification time).

Resume reuses recorded results and does not re-spend the token budget for them,
so a fully-resumed run reports `spent: 0`. Because cache hits are not
re-journaled, the journal a resumed run writes is empty — resuming a run that was
itself a resume therefore replays nothing.
