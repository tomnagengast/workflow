#!/usr/bin/env node
// Deterministic fake `claude` backend for tests.
//
// Invoked by the claude backend as:
//   claude -p PROMPT --output-format json [--model M] [extra --claude-arg ...]
//
// Emits the same envelope shape the real `claude -p --output-format json` does:
//   { "result": "<text>", "usage": { "output_tokens": N } }
// on stdout, exit 0. The runner parses `result` as the agent text and
// `usage.output_tokens` as the budget charge.
//
// For stable resume and journal tests, the result echoes a fixed
// summary of the prompt. When the prompt asks for JSON-matching-a-schema (the
// gate path, or any agent() given a schema), it returns a valid GATE_SCHEMA-ish
// object so tryParseJson + schemaOk succeed. output_tokens is a fixed constant.
//
// Shared `.mjs` lets source and compiled CLI tests execute the same fixture.

import fs from "node:fs";
import process from "node:process";

function main() {
  const argv = process.argv.slice(2);
  if (process.env.WORKFLOW_TEST_CLAUDE_ARGS) {
    fs.appendFileSync(process.env.WORKFLOW_TEST_CLAUDE_ARGS, `${JSON.stringify(argv)}\n`);
  }
  const pIdx = argv.indexOf("-p");
  const prompt = pIdx !== -1 ? (argv[pIdx + 1] ?? "") : "";
  const wantsJson = /Return only JSON matching this schema/.test(prompt);
  // a short stable label: first non-empty line of the TASK / GATE TASK body
  const label = (prompt.split("\n").find((l) => l.trim() && !/^(You are|Current|Agent label|Complete only|Workflow phase|You did NOT|TASK:|GATE TASK:|Return only)/.test(l.trim())) || "ok").trim();

  let result;
  if (wantsJson) {
    result = JSON.stringify({
      approved: true,
      blockers: [],
      decision: "",
      rationale: `fake-claude verdict on: ${label}`,
    });
  } else {
    result = `fake-claude: ${label}`;
  }
  process.stdout.write(JSON.stringify({ result, usage: { output_tokens: 7 } }));
  process.exit(0);
}

main();
