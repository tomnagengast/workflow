// Phase 5 — compat corpus gate.
//
// Runs EVERY workflow file through the rewrite's validator + loader + meta and
// records the ACCEPTED-NAME list as a committed snapshot. Phase 6 (the AST
// validator) must keep this set as a SUBSET of what it accepts — i.e. the AST
// accept-set ⊇ this snapshot — so swapping the regex heuristic for a real parse
// never silently drops a workflow that loads today.
//
// Two corpora:
//
//  1. The COMMITTED fixture corpus (test/fixtures/workflows/** +
//     test/fixtures/run-home/.claude/workflows/**). Deterministic and version-
//     controlled, so the accepted-name snapshot is stable and reproducible in CI
//     regardless of the machine's real `~/.claude/workflows`. This is the
//     Phase-6 superset baseline.
//
//  2. A BEST-EFFORT pass over the real `~/.claude/workflows` (skipped when
//     absent): asserts every real workflow still loads under the new
//     validator+loader without throwing. Its name-list is NOT committed (it
//     drifts as the author adds workflows), but the load-success check honors the
//     plan's "every real workflow loads" intent.
//
// Known corpus gotcha (PRESERVED, not fixed): a workflow that mutates but lacks
// the literal `MUTATING` marker is NOT flagged by the raw whole-file substring
// guard (`youtube-to-guide` in the real corpus). Characterization captures the
// current un-flagged behavior; changing the guard is a separate, explicit
// decision — see the plan.
//
// No top-level await.

import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseWorkflowFromSource } from "../../src/loader/meta.ts";
import { validateSource } from "../../src/loader/validate.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "..", "..");
const FIXTURES = path.join(REPO_ROOT, "test", "fixtures");
const SNAPSHOT_DIR = path.join(here, "snapshots");
const ACCEPTED_NAMES_SNAPSHOT = path.join(SNAPSHOT_DIR, "accepted-names.txt");
const UPDATE = process.env.WF_UPDATE_SNAPSHOTS === "1";

/** Every `.js` workflow file under a directory tree (recursive). */
function findWorkflowFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".js")) out.push(full);
    }
  };
  if (existsSync(root)) walk(root);
  return out;
}

/** Load one file the way `run` does: validate, then parse meta. Returns the row
 * on success, or throws on a validation/parse failure. */
function loadWorkflow(file: string, scope: "user" | "project") {
  const script = readFileSync(file, "utf8");
  validateSource(script, file);
  return parseWorkflowFromSource(script, file, scope);
}

describe("compat corpus — committed fixtures", () => {
  // The committed fixture corpus. Note: test/fixtures/workflows/user/nometa.js
  // has NO `export const meta` first statement, so the loader validator rejects
  // it — that rejection is itself characterized (it is NOT in the accepted set).
  const files = [
    ...findWorkflowFiles(path.join(FIXTURES, "workflows")),
    ...findWorkflowFiles(path.join(FIXTURES, "run-home", ".claude", "workflows")),
  ];

  test("the fixture corpus is non-empty", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  test("accepted-name list matches the committed snapshot", () => {
    const accepted: string[] = [];
    const rejected: Array<{ file: string; error: string }> = [];
    for (const file of files) {
      try {
        const row = loadWorkflow(file, "user");
        accepted.push(row.name);
      } catch (err) {
        rejected.push({
          file: path.relative(REPO_ROOT, file),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    // Dedup + sort: the accept-SET is what Phase 6 must remain a superset of.
    const acceptedSet = Array.from(new Set(accepted)).sort();
    const body = acceptedSet.join("\n") + "\n";

    if (UPDATE || !existsSync(ACCEPTED_NAMES_SNAPSHOT)) {
      mkdirSync(SNAPSHOT_DIR, { recursive: true });
      writeFileSync(ACCEPTED_NAMES_SNAPSHOT, body);
    }
    const snapshot = readFileSync(ACCEPTED_NAMES_SNAPSHOT, "utf8");
    expect(body).toBe(snapshot);

    // The no-meta fixture must be among the rejections (meta-first contract).
    expect(rejected.some((r) => r.file.endsWith("nometa.js"))).toBe(true);
  });

  test("MUTATING substring guard: marker present -> flagged; absent -> not", () => {
    const beta = loadWorkflow(
      path.join(FIXTURES, "workflows", "user", "beta.js"),
      "user",
    );
    expect(beta.mutating).toBe(true); // has the literal MUTATING marker
    const alpha = loadWorkflow(
      path.join(FIXTURES, "workflows", "user", "alpha.js"),
      "user",
    );
    expect(alpha.mutating).toBe(false); // no marker -> unflagged (preserved quirk)
  });
});

describe("compat corpus — real ~/.claude/workflows (best-effort)", () => {
  const realDir = path.join(homedir(), ".claude", "workflows");
  const realFiles = findWorkflowFiles(realDir);

  test.if(realFiles.length > 0)(
    "every real workflow loads under validator+loader without throwing",
    () => {
      const failures: Array<{ file: string; error: string }> = [];
      for (const file of realFiles) {
        try {
          loadWorkflow(file, "user");
        } catch (err) {
          failures.push({
            file: path.basename(file),
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      expect(failures).toEqual([]);
    },
  );

  test.if(realFiles.length > 0)(
    "youtube-to-guide gotcha preserved: mutating workflow lacking MUTATING marker is NOT flagged",
    () => {
      const ytg = path.join(realDir, "youtube-to-guide.js");
      if (!existsSync(ytg)) return; // only assert when present in this corpus
      const row = loadWorkflow(ytg, "user");
      // The raw substring guard only fires on the literal token MUTATING; this
      // workflow mutates guide.md but carries no marker, so it stays unflagged.
      // PRESERVED behavior — do not "fix" the guard here.
      expect(readFileSync(ytg, "utf8").includes("MUTATING")).toBe(false);
      expect(row.mutating).toBe(false);
    },
  );
});
