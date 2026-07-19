// Terminal rendering helpers. `paint` colorizes stdout via node:util
// `styleText`, which
// auto-strips styling when stdout is not a TTY (piped/redirected) or when
// NO_COLOR is set; `wrapText` word-wraps to a column width (no-op when width is
// unknown); `printTable` renders the `list` view. No top-level await.

import { styleText } from "node:util";
import type { Catalog } from "../types.ts";

/** Whether stdout should be colorized, matching node's `styleText({ stream })`
 * gating. Bun's `node:util styleText` does NOT honor NO_COLOR or the non-TTY
 * stream check (it always emits ANSI as of Bun 1.3.11), so we replicate node's
 * decision ourselves and skip styleText when color is off. Node's precedence:
 * FORCE_COLOR
 * (any value, even "0" enables level 1 in node's tty.hasColors? — node treats
 * FORCE_COLOR set to "" / "1"/"2"/"3" as on and "0"/"false" as off) overrides
 * NO_COLOR; otherwise NO_COLOR disables; otherwise require a TTY. */
function colorEnabled(): boolean {
  const force = process.env.FORCE_COLOR;
  if (force !== undefined) {
    // node: FORCE_COLOR="0"/"false" => off; anything else (incl. "") => on.
    return force !== "0" && force.toLowerCase() !== "false";
  }
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "") return false;
  return Boolean(process.stdout.isTTY);
}

/** Colorize `text` for stdout. Returns the raw text when color is disabled. */
export function paint(style: string | string[], text: string): string {
  if (!colorEnabled()) return text;
  // Cast at the boundary because styleText accepts a finite union while callers
  // use both single names and arrays.
  return styleText(style as Parameters<typeof styleText>[0], text, { stream: process.stdout });
}

/** Word-wrap `text` to `width` columns, one entry per line. Returns the text
 * intact when width is unknown or too small (piped output). */
export function wrapText(text: string, width: number): string[] {
  if (!width || width < 20) return [text];
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Render the `list` table to stdout. */
export function printTable(workflows: Catalog): void {
  const rows = Array.from(workflows.values()).sort((a, b) => a.name.localeCompare(b.name));
  const indent = "  ";
  // Reserve the indent so wrapped description lines stay inside the terminal.
  const wrapWidth = process.stdout.columns ? process.stdout.columns - indent.length : 0;

  for (const workflow of rows) {
    const badge = workflow.mutating
      ? ` ${paint(["bgRed", "whiteBright"], " mutating ")}`
      : "";
    console.log(`${paint("cyan", "•")} ${paint("bold", workflow.name)}${badge}`);

    const meta = [workflow.scope, workflow.phases.join(" → ")].filter(Boolean).join("  ·  ");
    if (meta) console.log(`${indent}${paint("dim", meta)}`);

    if (workflow.description) {
      for (const line of wrapText(workflow.description, wrapWidth)) {
        console.log(`${indent}${line}`);
      }
    }

    console.log("");
  }
}
