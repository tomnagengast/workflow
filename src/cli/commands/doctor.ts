// `doctor` command (Phase 6) — read-only environment diagnostics.
//
// Reports, in order:
//   - runtime: this binary's version + the Bun version it runs on;
//   - backends: whether `claude` / `codex` resolve on PATH (reuses the Phase 3
//     read-only backendOnPath preflight — NOT the run dispatch path);
//   - discovery roots: each [scope, dir] from workflowDirs, resolved to its
//     realpath, so the ~/.claude ↔ ~/.codex ↔ cmptr symlink situation is visible;
//     duplicate realpaths (two roots pointing at the same physical dir, i.e.
//     shadowing) are flagged;
//   - catalog: the live workflow count for this cwd.
//
// Pure diagnostic: no workflow body ever executes. `--json` emits the structured
// report; plain mode prints a human-readable summary. Always exits 0 (it reports
// state, it does not gate). No top-level await.

import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { backendOnPath } from "../../backends/index.ts";
import { catalog, workflowDirs } from "../../discovery/catalog.ts";
import { parseOptions } from "../args.ts";
import { version } from "../../version.ts";

interface BackendReport {
  name: string;
  bin: string;
  onPath: boolean;
  resolved: string | null;
}

interface RootReport {
  scope: string;
  dir: string;
  realpath: string | null;
  /** True when another root in the list resolves to the same realpath. */
  shadows: boolean;
}

interface DoctorReport {
  version: string;
  bun: string;
  backends: BackendReport[];
  roots: RootReport[];
  catalogCount: number;
}

/** Resolve a root to its realpath, or null when it cannot be resolved. */
function safeRealpath(dir: string): string | null {
  try {
    if (!existsSync(dir)) return null;
    return realpathSync(dir);
  } catch {
    return null;
  }
}

/** Gather the full diagnostic report for `cwd` (read-only). */
export function collectDoctor(cwd: string): DoctorReport {
  const backends: BackendReport[] = (["claude", "codex"] as const).map((bin) => {
    const resolved = backendOnPath(bin);
    return { name: bin, bin, onPath: resolved !== null, resolved };
  });

  const dirs = workflowDirs(cwd);
  const realpaths = dirs.map(([, dir]) => safeRealpath(dir));
  const roots: RootReport[] = dirs.map(([scope, dir], i) => {
    const real = realpaths[i] ?? null;
    const shadows =
      real !== null &&
      realpaths.some((other, j) => j !== i && other === real);
    return { scope, dir, realpath: real, shadows };
  });

  return {
    version,
    bun: Bun.version,
    backends,
    roots,
    catalogCount: catalog(cwd).size,
  };
}

export function doctor(cwd: string, args: string[]): number {
  const opts = parseOptions(args);
  const report = collectDoctor(cwd);

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }

  console.log(`workflow ${report.version}  (bun ${report.bun})`);

  console.log("");
  console.log("backends:");
  for (const backend of report.backends) {
    console.log(
      `  ${backend.name}: ${backend.onPath ? `found (${backend.resolved})` : "NOT on PATH"}`,
    );
  }

  console.log("");
  console.log("discovery roots:");
  if (report.roots.length === 0) {
    console.log("  (none)");
  } else {
    for (const root of report.roots) {
      const real =
        root.realpath === null
          ? " (unresolved)"
          : root.realpath === root.dir
            ? ""
            : ` -> ${root.realpath}`;
      const shadow = root.shadows ? "  [shadows another root: duplicate realpath]" : "";
      console.log(`  ${root.scope}: ${root.dir}${real}${shadow}`);
    }
  }

  console.log("");
  console.log(`catalog: ${report.catalogCount} workflow${report.catalogCount === 1 ? "" : "s"}`);

  return 0;
}
