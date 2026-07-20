// Shell out to `claude -p PROMPT
// --output-format json` (+ optional --model, --dangerously-skip-permissions,
// extra --claude-arg). Parse the JSON envelope: `result` is the text, `usage.
// output_tokens` the token count. With a schema, retry up to `schemaRetries + 1`
// times, re-framing the prompt with a "did not match schema" nudge; without a
// schema, one shot returning raw text. Process and launch failures throw
// immediately; only a schema mismatch is retried.
//
// No top-level await.

import type { BackendResult, Runtime } from "../types.ts";
import { tryParseJson, schemaOk } from "../schema/validate.ts";
import { failureContext } from "../runtime/output.ts";
import { spawnAsync } from "./spawn.ts";

/** Run the claude backend. */
export async function claudeBackend(prompt: string, schema: unknown, rt: Runtime): Promise<BackendResult> {
  const attempts = schema ? rt.schemaRetries + 1 : 1;
  let lastErr: Error | null = null;
  let p = prompt;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const args = ["-p", p, "--output-format", "json"];
    if (rt.model) args.push("--model", rt.model);
    if (rt.claudeYolo) args.push("--dangerously-skip-permissions");
    for (const extra of rt.claudeArgs) args.push(extra);

    const child = await spawnAsync(rt.claudeBin, args, { cwd: rt.cwd, verbose: rt.verbose });
    if (child.error) throw child.error;
    if (child.status !== 0) {
      throw new Error(
        `claude exited ${child.status}: ${failureContext(child.stderr, child.stdout)}`,
      );
    }
    let env: { result?: unknown; usage?: { output_tokens?: number } } | null;
    try { env = JSON.parse(child.stdout); } catch { env = null; }
    const text = env && typeof env.result === "string" ? env.result : child.stdout.trim();
    const tokens = env && env.usage ? (env.usage.output_tokens || 0) : 0;
    if (!schema) return { value: text, tokens };
    const obj = tryParseJson(text);
    if (obj && schemaOk(obj, schema)) return { value: obj, tokens };
    lastErr = new Error("agent reply did not match schema");
    p = `${prompt}\n\nYour previous reply did not match the required JSON schema. Return ONLY valid JSON matching it, no prose, no markdown fences.`;
  }
  throw lastErr || new Error("claude agent failed");
}
