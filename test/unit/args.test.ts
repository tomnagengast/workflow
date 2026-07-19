// FROZEN GOLDEN — parseOptions arg-parser table.
//
// Locks two semantics util.parseArgs would silently break:
//   1. Unknown-flag tolerance: `spec[key] || "boolean"` accepts any unknown
//      `--flag` as boolean, never throwing "Unknown option".
//   2. Option-like value consumption: `argv[++i]` consumes the NEXT token as the
//      value even when it looks like an option.
// Plus the supporting behaviors: kebab->camel keys, `=`-split inline values,
// array repeat, number coercion, "Missing value for X", positionals under `_`.

import { describe, expect, it } from "bun:test";
import { parseOptions } from "../../src/cli/args.ts";

describe("parseOptions (frozen)", () => {
  it("QUIRK 1: unknown flags are accepted as boolean (never throws)", () => {
    expect(parseOptions(["--totally-unknown", "--also-unknown=keep"], {})).toEqual({
      _: [],
      totallyUnknown: true,
      // `=`-split applies even to unknown flags: kind boolean ignores the inline value
      alsoUnknown: true,
    });
  });

  it("QUIRK 2: option-like value consumption (next token taken as value)", () => {
    // --model --backend codex name  =>  {model:"--backend"} with codex,name positionals
    expect(parseOptions(["--model", "--backend", "codex", "name"], { model: "string", backend: "string" })).toEqual({
      _: ["codex", "name"],
      model: "--backend",
    });
  });

  it("kebab->camel, =-split inline values, and number coercion", () => {
    expect(parseOptions(["--schema-retries=3", "--budget", "1000"], { schemaRetries: "number", budget: "number" })).toEqual({
      _: [],
      schemaRetries: 3,
      budget: 1000,
    });
  });

  it("array kind accumulates repeats", () => {
    expect(parseOptions(["--claude-arg", "a", "--claude-arg", "b"], { claudeArg: "array" })).toEqual({
      _: [],
      claudeArg: ["a", "b"],
    });
  });

  it("positionals collect under _ in order", () => {
    expect(parseOptions(["one", "--flag", "two"], {})).toEqual({ _: ["one", "two"], flag: true });
  });

  it("throws 'Missing value for X' when a valued flag ends the argv", () => {
    expect(() => parseOptions(["--model"], { model: "string" })).toThrow("Missing value for --model");
  });

  it("inline empty value via = is preserved (not treated as missing)", () => {
    expect(parseOptions(["--model="], { model: "string" })).toEqual({ _: [], model: "" });
  });
});
