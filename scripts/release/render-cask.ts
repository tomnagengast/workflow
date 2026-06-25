// Render the Homebrew cask `workflow-cli.rb` from scripts/release/cask.tmpl.
//
// Inputs (flags): a single --version, a --checksums file (one
// `<sha256>  <asset-name>` line per target, as produced by `shasum -a 256`), and
// a --repo (owner/name) used to build the GitHub Release download URLs. Output is
// written to --out (default Casks/workflow-cli.rb).
//
// The release workflow runs this as its final job, then commits the rendered
// cask into tomnagengast/homebrew-tap (the shared tap, Casks/ dir) — matching the
// sibling tools (scout-cli, memoryd-cli, ...). A small, pure, testable script
// (no ruby/erb toolchain) holds the dependency surface at zero.
//
// HARD CONSTRAINT: no top-level await — work runs inside main().

import { RELEASE_TARGETS, tarballName, assetArch } from "./targets.ts";

interface Options {
  version: string;
  checksums: string;
  repo: string;
  out: string;
  template: string;
}

function requireValue(argv: string[], i: number, flag: string): string {
  const value = argv[i];
  if (value === undefined) {
    console.error(`[render-cask] missing value for ${flag}`);
    process.exit(1);
  }
  return value;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    version: "",
    checksums: "",
    repo: "tomnagengast/workflow",
    out: "Casks/workflow-cli.rb",
    template: new URL("./cask.tmpl", import.meta.url).pathname,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--version":
        opts.version = requireValue(argv, ++i, arg);
        break;
      case "--checksums":
        opts.checksums = requireValue(argv, ++i, arg);
        break;
      case "--repo":
        opts.repo = requireValue(argv, ++i, arg);
        break;
      case "--out":
        opts.out = requireValue(argv, ++i, arg);
        break;
      case "--template":
        opts.template = requireValue(argv, ++i, arg);
        break;
      default:
        console.error(`[render-cask] ignoring unknown arg: ${arg}`);
    }
  }
  if (!opts.version) {
    console.error("[render-cask] --version is required");
    process.exit(1);
  }
  if (!opts.checksums) {
    console.error("[render-cask] --checksums is required");
    process.exit(1);
  }
  return opts;
}

/** Parse a `shasum`-style manifest into asset-name -> hex digest. */
export function parseChecksums(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/);
    if (!m || m[1] === undefined || m[2] === undefined) {
      throw new Error(`[render-cask] unparseable checksum line: ${line}`);
    }
    const name = (m[2].split("/").pop() ?? m[2]).trim();
    map.set(name, m[1].toLowerCase());
  }
  return map;
}

/** Strip a leading `v` so `version "..."` carries the bare semver. */
export function bareVersion(version: string): string {
  return version.replace(/^v/, "");
}

/** Render the cask template into Ruby source. */
export function renderCask(args: {
  template: string;
  version: string;
  repo: string;
  checksums: Map<string, string>;
}): string {
  const bare = bareVersion(args.version);
  const subs = new Map<string, string>();
  subs.set("VERSION", bare);
  subs.set("REPO", args.repo);

  for (const target of RELEASE_TARGETS) {
    const tarball = tarballName(target, bare);
    const sha = args.checksums.get(tarball);
    if (!sha) {
      throw new Error(
        `[render-cask] no checksum for asset ${tarball} (target ${target.key})`,
      );
    }
    const token = `${target.os.toUpperCase()}_${assetArch(target.arch).toUpperCase()}`;
    subs.set(`SHA256_${token}`, sha);
  }

  let out = args.template;
  for (const [key, value] of subs) {
    out = out.split(`{{${key}}}`).join(value);
  }
  const leftover = out.match(/\{\{[A-Z0-9_]+\}\}/);
  if (leftover) {
    throw new Error(`[render-cask] unfilled placeholder: ${leftover[0]}`);
  }
  return out;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const template = await Bun.file(opts.template).text();
  const checksums = parseChecksums(await Bun.file(opts.checksums).text());
  const rendered = renderCask({
    template,
    version: opts.version,
    repo: opts.repo,
    checksums,
  });
  await Bun.write(opts.out, rendered);
  console.error(`[render-cask] wrote ${opts.out} (v${bareVersion(opts.version)})`);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("[render-cask] FAILED:", error);
    process.exit(1);
  });
}
