// Render Formula/workflow.rb from scripts/release/formula.tmpl.
//
// Inputs (flags): a single --version, a --checksums file (one
// `<sha256>  <asset-name>` line per target, as produced by `sha256sum`), and a
// --repo (owner/name) used to build the GitHub Release download URLs. Output is
// written to --out (default Formula/workflow.rb).
//
// The release workflow runs this as its final job, then commits the rendered
// formula into the tomnagengast/homebrew-workflow tap. Keeping it a small,
// pure, testable script (no ruby/erb toolchain) holds the dependency surface
// at zero — it only reads the template + a checksums manifest.
//
// HARD CONSTRAINT: no top-level await — work runs inside main().

import { RELEASE_TARGETS, assetName } from "./targets.ts";

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
    console.error(`[render-formula] missing value for ${flag}`);
    process.exit(1);
  }
  return value;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    version: "",
    checksums: "",
    repo: "tomnagengast/workflow",
    out: "Formula/workflow.rb",
    template: new URL("./formula.tmpl", import.meta.url).pathname,
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
        console.error(`[render-formula] ignoring unknown arg: ${arg}`);
    }
  }
  if (!opts.version) {
    console.error("[render-formula] --version is required");
    process.exit(1);
  }
  if (!opts.checksums) {
    console.error("[render-formula] --checksums is required");
    process.exit(1);
  }
  return opts;
}

/** Parse a `sha256sum`-style manifest into asset-name -> hex digest. */
export function parseChecksums(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    // Format: "<64-hex>  <name>" (sha256sum) or "<64-hex> <name>".
    const m = line.match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/);
    if (!m || m[1] === undefined || m[2] === undefined) {
      throw new Error(`[render-formula] unparseable checksum line: ${line}`);
    }
    // Strip any leading path components; we match on basename.
    const name = (m[2].split("/").pop() ?? m[2]).trim();
    map.set(name, m[1].toLowerCase());
  }
  return map;
}

/** Strip a leading `v` so `version "..."` carries the bare semver. */
export function bareVersion(version: string): string {
  return version.replace(/^v/, "");
}

/** Render the formula template into Ruby source. */
export function renderFormula(args: {
  template: string;
  version: string;
  repo: string;
  checksums: Map<string, string>;
}): string {
  const bare = bareVersion(args.version);
  const tag = args.version.startsWith("v") ? args.version : `v${bare}`;
  const subs = new Map<string, string>();
  subs.set("VERSION", bare);

  for (const target of RELEASE_TARGETS) {
    const asset = assetName(target.key);
    const sha = args.checksums.get(asset);
    if (!sha) {
      throw new Error(
        `[render-formula] no checksum for asset ${asset} (target ${target.key})`,
      );
    }
    const url = `https://github.com/${args.repo}/releases/download/${tag}/${asset}`;
    const upper = target.key.toUpperCase().replace(/-/g, "_");
    subs.set(`URL_${upper}`, url);
    subs.set(`SHA256_${upper}`, sha);
  }

  let out = args.template;
  for (const [key, value] of subs) {
    out = out.split(`{{${key}}}`).join(value);
  }
  const leftover = out.match(/\{\{[A-Z0-9_]+\}\}/);
  if (leftover) {
    throw new Error(`[render-formula] unfilled placeholder: ${leftover[0]}`);
  }
  return out;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const template = await Bun.file(opts.template).text();
  const checksums = parseChecksums(await Bun.file(opts.checksums).text());
  const rendered = renderFormula({
    template,
    version: opts.version,
    repo: opts.repo,
    checksums,
  });
  await Bun.write(opts.out, rendered);
  console.error(`[render-formula] wrote ${opts.out} (v${bareVersion(opts.version)})`);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("[render-formula] FAILED:", error);
    process.exit(1);
  });
}
