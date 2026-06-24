// Unit — Homebrew formula renderer (scripts/release/render-formula.ts).
//
// Covers the pure render path: checksum-manifest parsing, version normalization,
// and template substitution (URLs per target, all 4 sha256s filled, no leftover
// placeholders, error on a missing checksum). Exercises against the real
// template so the four on_macos/on_linux × arch branches stay wired to the
// matrix in scripts/release/targets.ts.

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  parseChecksums,
  bareVersion,
  renderFormula,
} from "../../scripts/release/render-formula.ts";
import { RELEASE_TARGETS, assetName } from "../../scripts/release/targets.ts";

const TEMPLATE = readFileSync(
  path.join(import.meta.dir, "..", "..", "scripts", "release", "formula.tmpl"),
  "utf8",
);

const HEX = "a".repeat(64);
const HEX2 = "b".repeat(64);
const HEX3 = "c".repeat(64);
const HEX4 = "d".repeat(64);

function fullChecksums(): Map<string, string> {
  const hashes = [HEX, HEX2, HEX3, HEX4];
  const map = new Map<string, string>();
  RELEASE_TARGETS.forEach((t, i) => map.set(assetName(t.key), hashes[i] ?? HEX));
  return map;
}

describe("parseChecksums", () => {
  it("parses sha256sum-style lines (double-space)", () => {
    const m = parseChecksums(`${HEX}  workflow-darwin-arm64\n${HEX2}  workflow-linux-x64\n`);
    expect(m.get("workflow-darwin-arm64")).toBe(HEX);
    expect(m.get("workflow-linux-x64")).toBe(HEX2);
  });

  it("tolerates single-space and binary-mode '*' and blank lines", () => {
    const m = parseChecksums(`\n${HEX} workflow-a\n${HEX2} *workflow-b\n\n`);
    expect(m.get("workflow-a")).toBe(HEX);
    expect(m.get("workflow-b")).toBe(HEX2);
  });

  it("strips leading path components to the basename", () => {
    const m = parseChecksums(`${HEX}  dist/release/workflow-darwin-arm64\n`);
    expect(m.get("workflow-darwin-arm64")).toBe(HEX);
  });

  it("lowercases the digest", () => {
    const m = parseChecksums(`${"A".repeat(64)}  workflow-a\n`);
    expect(m.get("workflow-a")).toBe("a".repeat(64));
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

describe("renderFormula", () => {
  it("fills version, all 4 urls + sha256s, no leftover placeholders", () => {
    const out = renderFormula({
      template: TEMPLATE,
      version: "v1.2.3",
      repo: "tomnagengast/workflow",
      checksums: fullChecksums(),
    });

    expect(out).toContain('version "1.2.3"');
    expect(out).not.toMatch(/\{\{[A-Z0-9_]+\}\}/);

    for (const t of RELEASE_TARGETS) {
      const asset = assetName(t.key);
      expect(out).toContain(
        `https://github.com/tomnagengast/workflow/releases/download/v1.2.3/${asset}`,
      );
    }
    for (const hex of [HEX, HEX2, HEX3, HEX4]) {
      expect(out).toContain(`sha256 "${hex}"`);
    }
    // Multi-platform branches present.
    expect(out).toContain("class Workflow < Formula");
    expect(out).toContain("on_macos do");
    expect(out).toContain("on_linux do");
  });

  it("builds the tag with a v prefix even when given a bare version", () => {
    const out = renderFormula({
      template: TEMPLATE,
      version: "1.2.3",
      repo: "owner/repo",
      checksums: fullChecksums(),
    });
    expect(out).toContain("/releases/download/v1.2.3/workflow-darwin-arm64");
    expect(out).toContain('version "1.2.3"');
  });

  it("throws when a target's checksum is missing", () => {
    const partial = fullChecksums();
    const first = RELEASE_TARGETS[0]!;
    partial.delete(assetName(first.key));
    expect(() =>
      renderFormula({
        template: TEMPLATE,
        version: "v1.0.0",
        repo: "owner/repo",
        checksums: partial,
      }),
    ).toThrow(/no checksum for asset/);
  });
});
