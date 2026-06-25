# Install

`workflow` ships as a single self-contained binary for macOS (Apple Silicon and
Intel) and Linux (x64 and arm64), distributed through a Homebrew tap.

## Prerequisites

- A `claude` and/or `codex` CLI on your `PATH` — these are the runtime backends
  `workflow` drives. They are **not** bundled or installed by the cask.
  `workflow doctor` reports which backends it can find.
- For from-source runs only: [Bun](https://bun.sh).

## Homebrew

```
brew tap tomnagengast/tap
brew install --cask workflow-cli
```

`workflow-cli` lives in the shared `tomnagengast/homebrew-tap`, alongside the
sibling tools. The cask is multi-platform: macOS and Linux, arm64 and x64. The
Intel-Mac build uses Bun's baseline target, so it runs on pre-2013 CPUs without
an illegal-instruction crash.

## From source

```
bun install
bun run dev -- --version
bun run dev -- list
```

## Verify

```
workflow --version   # prints the released version
workflow --help      # prints usage
workflow list        # lists discovered workflows
```

If `workflow --help` is killed instead of rendering (a Gatekeeper SIGKILL on
macOS), the binary was not signed — file an issue; releases are ad-hoc signed in
CI specifically to prevent this.

## Releasing

Maintainers: see [release.md](release.md) for the tag-driven pipeline, signing
tier, required secrets, and fix-forward steps.
