# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and this project aims to follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Repo skeleton for the Bun + TypeScript rewrite: build/lang config, CLI
  entrypoint stub, agent-readiness floor (`AGENTS.md`, `CLAUDE.md` shim,
  `docs/agents/`, `dev/agent/` wrappers, `context:check`), and starter docs.
- `workflow --version` / `-v` — prints the version (genuinely missing from the
  legacy runner).
- `workflow list` / `workflow show <name>` — real read-only discovery against
  `~/.claude/workflows` + project `.claude/workflows`, with scope shadowing and
  meta-first parsing. `--json` carries the raw, un-flattened `meta` verbatim,
  byte-identical to the legacy runner.
