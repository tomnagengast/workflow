# Configuration

`workflow` resolves run defaults from three layers, highest priority first:

```
flags  >  user config  >  built-in defaults
```

A command-line flag always wins. When a flag is absent, the value falls back to
your user config file; when that is also absent, the built-in default applies.

With no config file and no flags, behavior is identical to the stock defaults —
the config file is purely additive.

## Config file

A single optional TOML file at:

```
~/.config/workflow/config.toml
```

(or `$XDG_CONFIG_HOME/workflow/config.toml` when `XDG_CONFIG_HOME` is set). There
is no per-repo config layer.

## Keys

Every key is optional and maps 1:1 to a `run` flag:

| Key | Flag | Default | Type |
| --- | --- | --- | --- |
| `backend` | `--backend` | `"claude"` | string (`claude` or `codex`) |
| `model` | `--model` | unset | string |
| `concurrency` | `--concurrency` | `min(16, max(2, cores - 2))` | positive integer |
| `budget` | `--budget` | unlimited | positive number |
| `claude_bin` | `--claude-bin` | `"claude"` | string (path) |
| `codex_bin` | `--codex-bin` | `"codex"` | string (path) |

`claude_bin` / `codex_bin` also accept the camelCase spellings `claudeBin` /
`codexBin`. Unknown keys are ignored.

### Example

```toml
backend = "codex"
concurrency = 8
budget = 200000
claude_bin = "/opt/claude/bin/claude"
```

## Inspecting the resolved config

```
workflow config --print-config
```

prints each resolved field with its provenance (`[default]` or `[user]`) and the
config file path. Add `--json` for the structured form. This shows the defaults a
`run` falls back to; per-run flags are layered on top at run time.
