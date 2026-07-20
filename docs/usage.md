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
- agent, gate, action, and nested-workflow start, cache hit, completion, and
  failure

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
- **`--resume FILE`:** replay cached `agent()`/`gate()`/`action()` results from
  a prior journal, skipping any dispatch whose result was already recorded.
- **`--resume-last` (or `resume --last <name>`):** replay the newest auto-journal
  in the state dir (resolved by modification time).

Resume reuses recorded results and does not re-spend the token budget for them,
so a fully resumed run reports `spent: 0`. Cache hits are recorded as
`step.cached`, which makes resumed runs fully observable and reusable as later
resume sources. Successful `null` agent or gate results remain successful and
are cacheable. Failed steps never enter the resume cache.

## Runtime globals

Top-level and nested workflows receive the same host functions:

| Global | Purpose |
| --- | --- |
| `agent(prompt, options?)` | Dispatch language or judgment work to the selected backend |
| `gate(prompt, options?)` | Review through an agent backend or a durable human gate |
| `action(spec)` | Run one deterministic executable and argument array |
| `parallel(thunks)` | Run independent thunks concurrently |
| `pipeline(items, ...stages)` | Process each item through a stage chain |
| `workflow(nameOrSpec, args?)` | Dispatch a discovered or explicit nested workflow |
| `phase(title)` | Record the active phase |
| `log(message)` | Record workflow progress |
| `budget` | Inspect token budget totals and spend |
| `args` | Read the run input |

Use `agent()` and `gate()` for judgment and language work. Use `action()` only
when the executable, arguments, and interpretation are fixed.

## Deterministic host actions

`action()` accepts one object:

```js
const result = await action({
  executable: "/usr/bin/git",
  arguments: ["status", "--short"],
  cwd: "optional/path/relative/to/the/run/directory",
  stdin: "optional exact input",
  timeoutMs: 10_000,
})
```

- `executable` is a non-empty string.
- `arguments` is a required array of strings. Values pass directly to the
  process with no shell parsing or interpolation.
- `cwd` is optional and resolves from the run directory.
- `stdin` is optional. Its content is not written to the semantic journal.
- `timeoutMs` is required and must be an integer from 1 through 86,400,000.

A successful action returns:

```json
{
  "status": 0,
  "signal": null,
  "stdout": "...",
  "stderr": "...",
  "stdoutBytes": 3,
  "stderrBytes": 0,
  "stdoutTruncated": false,
  "stderrTruncated": false,
  "timedOut": false,
  "cancelled": false
}
```

Stdout and stderr each retain at most 1 MiB. Output beyond that bound keeps
useful head and tail text with a truncation marker, while the byte count records
the full observed size. `SIGINT`, `SIGTERM`, and timeout terminate the process
group. Nonzero exit, timeout, cancellation, invalid input, and launch failure
throw `WorkflowStepError`; they do not return a result.

Actions emit the existing ordered `step.started`, `step.completed`,
`step.cached`, and `step.failed` journal events with `kind: "action"` and
`backend: "host"`. Successful actions enter the resume cache so an explicit
resume does not repeat an external mutation. The action cache identity includes
the workflow path, normalized spec, and occurrence count for that same action.

## Failure contract

Backend unavailability, backend process or schema failure, and action failure
throw `WorkflowStepError`. The error carries a stable `code` and `stepKind`;
action failures also carry their bounded process `result` when a process
started. The matching `step.failed` and terminal `runtime.failed` journal events
record `errorCode` and the bounded cause.

Backend stderr is bounded and preserves both its head and tail, so a quota or
process cause near the end is not lost. A nonzero Claude process is not retried;
only a successful Claude response that misses a requested schema may use the
configured schema retries. `parallel()` and `pipeline()` propagate
`WorkflowStepError`, `BudgetError`, and human suspension. They retain their
existing behavior of turning an ordinary exception thrown by workflow source
into `null`.

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
