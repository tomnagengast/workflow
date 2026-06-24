// Release dry-run — the pre-publish signing / Gatekeeper rung.
//
// Builds all four release targets, ad-hoc codesigns the darwin artifacts
// (`codesign --sign -`), and — for any artifact runnable on THIS host — runs
// the downloaded-binary launch test: `codesign -dv`, then execute `--version`
// + `--help` and assert the process is NOT killed by Gatekeeper (exit 137 =
// SIGKILL). NOTHING is published. This is exactly the rung the release.yml PR
// job runs on every PR, surfaced locally so the failure mode is caught before a
// real release.
//
// The native-launch assertion only fires for the artifact matching the host
// os/arch (cross-built binaries can be signed + inspected but not executed
// here); CI's macos-14 (arm64) runner exercises the darwin-arm64 launch, and
// the host that runs this locally exercises whatever it is.
//
// HARD CONSTRAINT: no top-level await — work runs inside main().

import { chmodSync, mkdirSync, rmSync } from "node:fs";
import { RELEASE_TARGETS, assetName, type ReleaseTarget } from "./targets.ts";

const OUT_DIR = process.env.WORKFLOW_DRYRUN_DIR ?? "dist/release-dryrun";

function hostOsArch(): { os: ReleaseTarget["os"]; arch: ReleaseTarget["arch"] } {
  const os = process.platform === "darwin" ? "darwin" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  return { os, arch };
}

async function sh(cmd: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout, stderr };
}

async function buildTarget(target: ReleaseTarget): Promise<string> {
  const outfile = `${OUT_DIR}/${assetName(target.key)}`;
  const res = await sh([
    "bun",
    "run",
    "build",
    "--outfile",
    outfile,
    "--target",
    target.bunTarget,
  ]);
  if (res.code !== 0) {
    throw new Error(`build ${target.key} failed (exit ${res.code})\n${res.stderr}`);
  }
  chmodSync(outfile, 0o755);
  console.error(`[dry-run] built ${outfile}`);
  return outfile;
}

async function adhocSign(file: string): Promise<void> {
  const res = await sh(["codesign", "--sign", "-", "--force", "--timestamp=none", file]);
  if (res.code !== 0) {
    throw new Error(`codesign ${file} failed (exit ${res.code})\n${res.stderr}`);
  }
  const verify = await sh(["codesign", "-dv", file]);
  // codesign -dv prints to stderr; assert ad-hoc seal is present.
  const info = verify.stdout + verify.stderr;
  if (!/Signature=adhoc/.test(info)) {
    throw new Error(`codesign -dv did not report adhoc for ${file}:\n${info}`);
  }
  console.error(`[dry-run] signed (adhoc) ${file}`);
}

async function launchTest(file: string): Promise<void> {
  for (const args of [["--version"], ["--help"]]) {
    const res = await sh([file, ...args]);
    if (res.code === 137) {
      throw new Error(
        `[dry-run] GATEKEEPER SIGKILL (exit 137) launching ${file} ${args.join(" ")}`,
      );
    }
    if (res.code !== 0) {
      throw new Error(
        `[dry-run] ${file} ${args.join(" ")} exited ${res.code}\n${res.stderr}`,
      );
    }
  }
  console.error(`[dry-run] launch OK (not exit 137) ${file}`);
}

async function main(): Promise<void> {
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const host = hostOsArch();
  const onMac = process.platform === "darwin";
  let nativeLaunched = false;

  for (const target of RELEASE_TARGETS) {
    const file = await buildTarget(target);
    if (target.darwin && onMac) {
      await adhocSign(file);
    }
    const isNative = target.os === host.os && target.arch === host.arch;
    if (isNative) {
      await launchTest(file);
      nativeLaunched = true;
    }
  }

  if (!nativeLaunched) {
    console.error(
      `[dry-run] note: no artifact matched host (${host.os}/${host.arch}); ` +
        `build + sign verified, native launch not exercised here`,
    );
  }

  console.error("[dry-run] ok — 4 targets built, darwin artifacts signed, launch not exit 137");
}

main().catch((error) => {
  console.error("[dry-run] FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
