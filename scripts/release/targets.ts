// Single source of truth for the release matrix.
//
// Four prebuilt single-file binaries are cross-compiled from one host via
// `bun build --compile --target <bunTarget>` (see scripts/build.ts, which the
// release workflow drives). The Homebrew formula's on_macos / on_linux ×
// Hardware::CPU.arm? branches map 1:1 onto these.
//
// `bun-darwin-x64-baseline` (literal hyphenated triple) trades a little perf
// for pre-2013 Intel-Mac compatibility — it avoids the SSE4/AVX2 illegal-
// instruction crashes a modern build would throw on old CPUs (plan Q3 default).
//
// HARD CONSTRAINT: no top-level await — this module only exports data.

export interface ReleaseTarget {
  /** Stable artifact key; also the released asset's basename suffix. */
  key: string;
  /** Value passed to `bun build --target`. */
  bunTarget: string;
  os: "darwin" | "linux";
  arch: "arm64" | "x64";
  /** darwin artifacts get ad-hoc codesigned + Gatekeeper-launch-tested. */
  darwin: boolean;
}

export const RELEASE_TARGETS: ReleaseTarget[] = [
  {
    key: "darwin-arm64",
    bunTarget: "bun-darwin-arm64",
    os: "darwin",
    arch: "arm64",
    darwin: true,
  },
  {
    key: "darwin-x64",
    bunTarget: "bun-darwin-x64-baseline",
    os: "darwin",
    arch: "x64",
    darwin: true,
  },
  {
    key: "linux-x64",
    bunTarget: "bun-linux-x64",
    os: "linux",
    arch: "x64",
    darwin: false,
  },
  {
    key: "linux-arm64",
    bunTarget: "bun-linux-arm64",
    os: "linux",
    arch: "arm64",
    darwin: false,
  },
];

/** Released asset name for a target (raw-binary form, used by the PR dry-run). */
export function assetName(key: string): string {
  return `workflow-${key}`;
}

/** Homebrew/GoReleaser-style arch token: x64 -> amd64, arm64 -> arm64. */
export function assetArch(arch: ReleaseTarget["arch"]): "amd64" | "arm64" {
  return arch === "x64" ? "amd64" : "arm64";
}

/**
 * Released tarball name for a target at a given version, matching the
 * tomnagengast Homebrew family convention: `workflow_<version>_<os>_<arch>.tar.gz`
 * (arch as amd64/arm64). Each tarball holds a single `workflow` binary.
 */
export function tarballName(target: ReleaseTarget, version: string): string {
  const bare = version.replace(/^v/, "");
  return `workflow_${bare}_${target.os}_${assetArch(target.arch)}.tar.gz`;
}
