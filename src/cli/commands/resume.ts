// `resume` command (Phase 8) — thin alias surface for replaying the last run.
//
// The plan offers two spellings for the same behavior: `run <wf> --resume-last`
// and `resume --last <wf>`. This command is just sugar over `run`: it requires
// `--last`, then delegates to the exact same `run` code path with `--resume-last`
// injected, so there is ONE resume implementation (no behavior fork).
//
// No top-level await.

import type { Catalog } from "../../types.ts";
import { run } from "./run.ts";

/** `resume --last <workflow> [run flags…]` -> `run <workflow> --resume-last …`.
 * `--last` is currently the only supported mode (no run-id index exists yet —
 * deferred per plan). The remaining args are passed through to `run` untouched. */
export async function resume(workflows: Catalog, cwd: string, args: string[]): Promise<number> {
  if (!args.includes("--last")) {
    throw new Error("resume currently supports only `--last` (e.g. `resume --last <workflow>`).");
  }
  // Strip `--last`, hand the rest to `run` with the equivalent `--resume-last`.
  const passthrough = args.filter((a) => a !== "--last");
  return run(workflows, cwd, ["--resume-last", ...passthrough]);
}
