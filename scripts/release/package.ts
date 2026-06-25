// Build, sign, and package the four release tarballs + checksums.
//
// For each target in the matrix: cross-compile a single-file binary named
// `workflow` via scripts/build.ts (--compile --minify --bytecode, version
// injected), ad-hoc codesign the darwin artifacts, and tar each into the
// family-convention `workflow_<version>_<os>_<arch>.tar.gz` (one binary per
// tarball). Then emit `checksums.txt` + `SHA256SUMS`. On a darwin host, the
// host-native artifact is launch-tested (must not exit 137 / Gatekeeper SIGKILL).
//
// Output dir: $WORKFLOW_RELEASE_DIR or --out (default dist/release).
//
// HARD CONSTRAINT: no top-level await — work runs inside main().

import { $ } from "bun";
import { mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { RELEASE_TARGETS, tarballName, assetArch } from "./targets.ts";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const outFlag = argv.indexOf("--out");
  const outDir =
    (outFlag !== -1 ? argv[outFlag + 1] : undefined) ??
    process.env.WORKFLOW_RELEASE_DIR ??
    "dist/release";

  const pkg = JSON.parse(await readFile("package.json", "utf8")) as { version: string };
  const version = pkg.version;
  const buildScript = new URL("../build.ts", import.meta.url).pathname;

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  console.error(`[package] workflow v${version} -> ${outDir}`);

  for (const target of RELEASE_TARGETS) {
    const stage = join(outDir, `stage-${target.key}`);
    await mkdir(stage, { recursive: true });
    const bin = join(stage, "workflow");
    console.error(`[package] build ${target.key} (${target.bunTarget})`);
    await $`bun run ${buildScript} --target ${target.bunTarget} --outfile ${bin}`.quiet();
    if (target.darwin) {
      await $`codesign --sign - --force ${bin}`.quiet();
      await $`codesign -dv ${bin}`.quiet(); // throws if the ad-hoc seal is missing
    }
    const tar = tarballName(target, version);
    await $`tar -C ${stage} -czf ${join(outDir, tar)} workflow`;
    await rm(stage, { recursive: true, force: true });
  }

  // Checksums over the four tarballs (basenames only).
  const names = RELEASE_TARGETS.map((t) => tarballName(t, version));
  const sums = await $`shasum -a 256 ${names}`.cwd(outDir).text();
  await writeFile(join(outDir, "checksums.txt"), sums);
  await writeFile(join(outDir, "SHA256SUMS"), sums);
  console.error(`[package] checksums:\n${sums.trim()}`);

  // Gatekeeper launch test on a darwin host: the host-native tarball must run.
  if (process.platform === "darwin") {
    const arch = process.arch === "x64" ? "amd64" : "arm64";
    const host = RELEASE_TARGETS.find((t) => t.os === "darwin" && assetArch(t.arch) === arch);
    if (host) {
      const probe = join(outDir, "probe");
      await mkdir(probe, { recursive: true });
      await $`tar -C ${probe} -xzf ${join(outDir, tarballName(host, version))}`;
      const got = (await $`${join(probe, "workflow")} --version`.text()).trim();
      await rm(probe, { recursive: true, force: true });
      if (got !== version) {
        throw new Error(`[package] launch test: printed ${got}, expected ${version}`);
      }
      console.error(`[package] launch test ok (darwin-${arch} prints ${got}, not a SIGKILL)`);
    }
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("[package] FAILED:", error);
    process.exit(1);
  });
}
