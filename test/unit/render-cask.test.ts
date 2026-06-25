// Unit — Homebrew cask renderer (scripts/release/render-cask.ts).
//
// Covers the pure render path: checksum-manifest parsing, version normalization,
// and template substitution (all 4 sha256s filled, repo + version interpolated,
// no leftover placeholders, error on a missing checksum). Exercises against the
// real template so the four on_macos/on_linux × arch branches stay wired to the
// matrix in scripts/release/targets.ts.

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  parseChecksums,
  bareVersion,
  renderCask,
} from "../../scripts/release/render-cask.ts";
import { RELEASE_TARGETS, tarballName } from "../../scripts/release/targets.ts";

const TEMPLATE = readFileSync(
  path.join(import.meta.dir, "..", "..", "scripts", "release", "cask.tmpl"),
  "utf8",
);

const HEX = "a".repeat(64);
const HEX2 = "b".repeat(64);
const HEX3 = "c".repeat(64);
const HEX4 = "d".repeat(64);

function fullChecksums(version: string): Map<string, string> {
  const hashes = [HEX, HEX2, HEX3, HEX4];
  const map = new Map<string, string>();
  RELEASE_TARGETS.forEach((t, i) => map.set(tarballName(t, version), hashes[i] ?? HEX));
  return map;
}

describe("parseChecksums", () => {
  it("parses shasum-style lines (double-space)", () => {
    const m = parseChecksums(
      `${HEX}  workflow_1.2.3_darwin_arm64.tar.gz\n${HEX2}  workflow_1.2.3_linux_amd64.tar.gz\n`,
    );
    expect(m.get("workflow_1.2.3_darwin_arm64.tar.gz")).toBe(HEX);
    expect(m.get("workflow_1.2.3_linux_amd64.tar.gz")).toBe(HEX2);
  });

  it("tolerates single-space and binary-mode '*' and blank lines", () => {
    const m = parseChecksums(`\n${HEX} a.tar.gz\n${HEX2} *b.tar.gz\n\n`);
    expect(m.get("a.tar.gz")).toBe(HEX);
    expect(m.get("b.tar.gz")).toBe(HEX2);
  });

  it("strips leading path components to the basename", () => {
    const m = parseChecksums(`${HEX}  dist/release/workflow_1.2.3_darwin_arm64.tar.gz\n`);
    expect(m.get("workflow_1.2.3_darwin_arm64.tar.gz")).toBe(HEX);
  });

  it("lowercases the digest", () => {
    const m = parseChecksums(`${"A".repeat(64)}  a.tar.gz\n`);
    expect(m.get("a.tar.gz")).toBe("a".repeat(64));
  });

  it("throws on an unparseable line", () => {
    expect(() => parseChecksums("not a checksum line")).toThrow();
  });
});

describe("bareVersion", () => {
  it("strips a leading v", () => {
    expect(bareVersion("v1.2.3")).toBe("1.2.3");
    expect(bareVersion("1.2.3")).toBe("1.2.3");
  });
});

describe("renderCask", () => {
  it("fills version, repo, all 4 sha256s, no leftover placeholders", () => {
    const out = renderCask({
      template: TEMPLATE,
      version: "v1.2.3",
      repo: "tomnagengast/workflow",
      checksums: fullChecksums("1.2.3"),
    });

    expect(out).toContain('cask "workflow-cli" do');
    expect(out).toContain('version "1.2.3"');
    expect(out).not.toMatch(/\{\{[A-Z0-9_]+\}\}/);

    for (const hex of [HEX, HEX2, HEX3, HEX4]) {
      expect(out).toContain(`sha256 "${hex}"`);
    }
    // Multi-platform branches present + binary artifact + quarantine-strip.
    expect(out).toContain("on_macos do");
    expect(out).toContain("on_linux do");
    expect(out).toContain('binary "workflow"');
    expect(out).toContain("com.apple.quarantine");
    // The repo is interpolated into the homepage; URLs use ruby #{version}.
    expect(out).toContain("homepage \"https://github.com/tomnagengast/workflow\"");
  });

  it("normalizes a bare version the same as a v-prefixed one", () => {
    const out = renderCask({
      template: TEMPLATE,
      version: "1.2.3",
      repo: "owner/repo",
      checksums: fullChecksums("1.2.3"),
    });
    expect(out).toContain('version "1.2.3"');
    expect(out).toContain('homepage "https://github.com/owner/repo"');
  });

  it("throws when a target's checksum is missing", () => {
    const partial = fullChecksums("1.0.0");
    const first = RELEASE_TARGETS[0]!;
    partial.delete(tarballName(first, "1.0.0"));
    expect(() =>
      renderCask({
        template: TEMPLATE,
        version: "v1.0.0",
        repo: "owner/repo",
        checksums: partial,
      }),
    ).toThrow(/no checksum for asset/);
  });
});
