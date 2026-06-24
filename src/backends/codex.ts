// codex backend.
//
// Byte-faithful to the monolith's `codexBackend`
// (`/Users/tom/cmptr/bin/workflow` ~416-445): run `codex exec --skip-git-repo-
// check --cd CWD` (+ optional --model, --sandbox, --dangerously-bypass-
// approvals-and-sandbox, extra --codex-arg). Output is read from a temp file via
// `--output-last-message`; an optional `--output-schema` enforces structured
// output. Tokens are NOT surfaced by codex, so they are always 0 (budget is
// claude-accurate only). The temp dir is always cleaned up.
//
// No top-level await.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BackendResult, Runtime } from "../types.ts";
import { spawnAsync } from "./spawn.ts";

/** Map an engine-specific JSON.parse failure to the Node V8 canonical message so
 * the journal's `error` string is engine-independent (the node monolith is the
 * frozen byte reference). Empty/whitespace-only output (the realistic case: codex
 * wrote nothing to the --output-last-message file) is V8's "Unexpected end of JSON
 * input". For any other malformed input we cannot reconstruct V8's positional text
 * from Bun's message, so we fall back to the engine's own text. */
function nodeJsonParseMessage(output: string, err: Error): string {
  if (output.trim() === "") return "Unexpected end of JSON input";
  return String(err.message || err);
}

/** Run the codex backend. Byte-identical to the monolith's `codexBackend`. */
export async function codexBackend(prompt: string, schema: unknown, rt: Runtime): Promise<BackendResult> {
  const args = ["exec", "--skip-git-repo-check", "--cd", rt.cwd];
  if (rt.model) args.push("--model", rt.model);
  if (rt.sandbox) args.push("--sandbox", rt.sandbox);
  if (rt.codexYolo) args.push("--dangerously-bypass-approvals-and-sandbox");
  for (const extra of rt.codexArgs) args.push(extra);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-"));
  const resultFile = path.join(dir, "result.txt");
  fs.writeFileSync(resultFile, "");
  args.push("--output-last-message", resultFile);
  let schemaFile: string | null = null;
  if (schema) {
    schemaFile = path.join(dir, "schema.json");
    fs.writeFileSync(schemaFile, JSON.stringify(schema, null, 2));
    args.push("--output-schema", schemaFile);
  }
  args.push(prompt);
  try {
    const child = await spawnAsync(rt.codexBin, args, { cwd: rt.cwd, verbose: rt.verbose });
    if (child.error) throw child.error;
    if (child.status !== 0) throw new Error(`codex exec exited with ${child.status}: ${(child.stderr || "").slice(0, 400)}`);
    const output = fs.readFileSync(resultFile, "utf8").trim();
    // codex enforces --output-schema, so tokens aren't surfaced here (budget is claude-accurate only).
    if (!schema) return { value: output, tokens: 0 };
    // The monolith does a raw `JSON.parse(output)` here and lets the engine's
    // error propagate into the journal's `error` string. Under Bun that message
    // text diverges from Node's (e.g. "JSON Parse error: Unexpected EOF" vs
    // "Unexpected end of JSON input"), which would break journal byte-parity with
    // the node monolith on the parse-failure path. Re-throw with the Node-engine
    // canonical text so the captured journal error string is engine-independent.
    try {
      return { value: JSON.parse(output), tokens: 0 };
    } catch (err) {
      throw new Error(nodeJsonParseMessage(output, err as Error));
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
