# Install

> Stub — filled in when the release pipeline lands. Until then, run from source.

## Prerequisites

- A `claude` and/or `codex` CLI on your `PATH` (runtime backends; not bundled).
- For from-source runs: [Bun](https://bun.sh).

## Homebrew (planned)

Once releases are cut:

```
brew tap tomnagengast/workflow
brew install workflow
workflow --version
```

## From source

```
bun install
bun run dev -- --version
bun run dev -- list
```

## Verify

```
workflow --version   # prints the version
workflow --help      # prints usage
```
