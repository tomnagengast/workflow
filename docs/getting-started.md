# Getting started

> Stub — expanded as `list` / `show` / `run` land in later phases.

`workflow` runs the dynamic-workflow scripts already in your
`~/.claude/workflows` (and any project `.claude/workflows`).

## 1. Confirm it runs

```
workflow --version
workflow --help
```

## 2. See your workflows

```
workflow list
```

## 3. Run one

```
workflow run <name> --args '{"key":"value"}'
```

You can also run a file that lives outside the target project:

```sh
workflow --cwd /path/to/project run /path/to/workflow.js
```

`run` dispatches to a real `claude` (default) or `codex` backend, so the relevant
CLI must be installed and on your `PATH`. See [usage.md](usage.md) for the full
option set.
