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
- `validate <name|path> [--json]` — validate a discovered workflow or explicit
  workflow file without running it.
- `run <name|path> [--args JSON|@file]` — run a discovered workflow or an
  explicit workflow file against real subagents.
- `resume --last <name> [run options]` — replay the most recent run of `<name>`
  (sugar for `run <name> --resume-last`).

Run `workflow --help` for the full, current option set (backend, concurrency,
budget, journaling, and backend-specific flags). This document tracks that help
text as each command is implemented.

## Validation

`validate` uses the same loader checks as `run`, but never executes the
workflow:

```sh
workflow validate <name>
workflow validate /path/to/workflow.js
```

It checks the complete JavaScript source, the required first metadata export,
the source size limit, and constructs that would break deterministic resume.
Use `--json` for machine-readable output.

## Explicit workflow files

`run` accepts an explicit workflow file without adding it to a discovery root:

```sh
workflow --cwd /path/to/project run /path/to/workflow.js
```

The file supplies the workflow source and metadata. `--cwd` remains the working
directory for Claude Code or Codex, so the workflow can live outside the project
it operates on. Relative workflow paths resolve from the invoking shell.

## Journaling & resume

Every `run` writes one ordered JSONL stream containing each semantic runtime
observation before execution continues:

- runtime start, resume, suspension, completion, and failure
- phase changes, workflow logs, and diagnostics
- agent, gate, and nested-workflow start, cache hit, completion, and failure

Every event has a contiguous `sequence`, timestamp, event `type`, and workflow
name. Step events also carry their stable cache key, per-run step ID, backend,
kind, prompt, result, error, and token count when applicable. Auto-written and
explicit journals use the same format.

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
so a fully resumed run reports `spent: 0`. Cache hits are recorded as
`step.cached`, which makes resumed runs fully observable and reusable as later
resume sources.

## Gate reviewers

`gate()` keeps its existing opposite-backend behavior when `reviewer` is
omitted or set to `agent`:

```js
const verdict = await gate("Review the release plan.")
const sameRoute = await gate("Review the release plan.", { reviewer: "agent" })
```

Pin a reviewer backend when the workflow needs a specific engine:

```js
const codexReview = await gate("Review the patch.", { reviewer: "codex" })
const claudeReview = await gate("Review the patch.", { reviewer: "claude" })
```

`reviewer: "human"` records the gate request and `runtime.suspended`, then exits
with status 75. The terminal does not prompt for input. An external coordinator
can append a matching `step.completed` event and rerun with the same file as
both `--journal` and `--resume`. The run appends `runtime.resumed`, returns the
cached human result at the gate, and continues.

A human gate without `schema` accepts a plain text result. When `schema` is
present, the external coordinator should collect and validate JSON matching
that schema.
