#!/usr/bin/env node
// Deterministic fake `codex` backend for tests.
//
// Invoked by the codex backend as:
//   codex exec --skip-git-repo-check --cd CWD [--model M] [--sandbox S]
//        [extra --codex-arg ...] --output-last-message FILE
//        [--output-schema FILE] PROMPT
//
// codex surfaces its answer via the `--output-last-message` file (NOT stdout) and
// enforces structure via `--output-schema`, so tokens are never surfaced (the
// runner charges 0). This fake writes a deterministic result to that file: a
// schema-shaped JSON object when `--output-schema` was passed (the gate path),
// else plain text echoing the prompt. exit 0.
//
// Shared `.mjs` lets source and compiled CLI tests execute the same fixture.

import fs from "node:fs";
import process from "node:process";

function main() {
  const argv = process.argv.slice(2);
  if (process.env.WORKFLOW_TEST_CODEX_ARGS) {
    fs.appendFileSync(process.env.WORKFLOW_TEST_CODEX_ARGS, `${JSON.stringify(argv)}\n`);
  }
  const outIdx = argv.indexOf("--output-last-message");
  const outFile = outIdx !== -1 ? argv[outIdx + 1] : null;
  const hasSchema = argv.indexOf("--output-schema") !== -1;
  // codex puts the PROMPT as the final positional arg
  const prompt = argv[argv.length - 1] || "";
  const label = (prompt.split("\n").find((l) => l.trim() && !/^(You are|Current|Agent label|Complete only|Workflow phase|You did NOT|TASK:|GATE TASK:|Return only)/.test(l.trim())) || "ok").trim();

  let result;
  if (hasSchema) {
    result = JSON.stringify({
      approved: true,
      blockers: [],
      decision: "",
      rationale: `fake-codex verdict on: ${label}`,
    });
  } else {
    result = `fake-codex: ${label}`;
  }
  if (outFile) fs.writeFileSync(outFile, result);
  process.exit(0);
}

main();
