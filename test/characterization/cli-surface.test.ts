// Characterization tests for the CLI's stable output.
//
// The snapshots live in ./snapshots/ and are checked in. Regenerate them with
// WF_UPDATE_SNAPSHOTS=1 when accepting an intentional output change.
//
// Surfaces covered (per the Phase 5 plan):
//   --help; list plain + --json; show plain + --json; discovery precedence +
//   shadowing; invalid workflow name; unknown workflow; missing option value;
//   invalid backend; mutating refusal; string-result -> raw stdout; object-result
//   -> pretty JSON; fake-claude {result,usage.output_tokens} parse; fake-codex
//   --output-last-message parse; parallel() null-on-throw; pipeline() per-item
//   stages; nested workflow(); gate() opposite-backend dispatch.
//
// Order-nondeterministic stderr (parallel/pipeline interleaving) is NOT snapshot
// byte-for-byte: those cases snapshot stdout+exit and assert the stable stderr
// lines structurally. Engine-dependent JSON.parse error text is also checked by
// structure rather than exact bytes.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync } from "node:fs";
import path from "node:path";
import {
  characterize,
  FAKE_CLAUDE,
  FAKE_CODEX,
  FIXTURES,
  type FixtureEnv,
  makeEnv,
  runCli,
} from "./harness.ts";

// ---- discovery / list / show: the user-workflows fixture set ----
describe("discovery + list + show surface", () => {
  let env: FixtureEnv;
  beforeAll(() => {
    env = makeEnv(path.join(FIXTURES, "workflows", "user"));
  });
  afterAll(() => env.dispose());

  test("--help", async () => {
    await characterize(env, "help.txt", ["--help"], { includeStdout: true });
  });

  test("list (plain)", async () => {
    await characterize(env, "list-plain.txt", ["list"]);
  });

  test("list --json (raw un-flattened meta carried verbatim)", async () => {
    await characterize(env, "list-json.txt", ["list", "--json"]);
  });

  test("show alpha (plain key: value)", async () => {
    await characterize(env, "show-alpha-plain.txt", ["show", "alpha"]);
  });

  test("show alpha --json (full row incl. raw meta)", async () => {
    await characterize(env, "show-alpha-json.txt", ["show", "alpha", "--json"]);
  });

  test("show beta --json (MUTATING substring -> mutating:true)", async () => {
    await characterize(env, "show-beta-json.txt", ["show", "beta", "--json"]);
  });

  test("show nometa --json (synthesized default row)", async () => {
    await characterize(env, "show-nometa-json.txt", ["show", "nometa", "--json"]);
  });

  test("unknown workflow -> exit 1, sorted Available list on stderr", async () => {
    await characterize(env, "show-unknown.txt", ["show", "does-not-exist"], {
      includeStdout: true,
      includeStderr: true,
    });
  });

  test("invalid workflow name -> exit 1", async () => {
    await characterize(env, "show-invalid-name.txt", ["show", "../etc"], {
      includeStdout: true,
      includeStderr: true,
    });
  });
});

// ---- discovery precedence: a project `.claude/workflows` shadows user scope ----
describe("discovery precedence + shadowing", () => {
  let env: FixtureEnv;
  beforeAll(() => {
    env = makeEnv(path.join(FIXTURES, "workflows", "user"));
    // Drop a project-scope `alpha` into the cwd so it shadows the user-scope one.
    const projWorkflows = path.join(env.cwd, ".claude", "workflows");
    mkdirSync(projWorkflows, { recursive: true });
    cpSync(
      path.join(FIXTURES, "workflows", "project", "repo", ".claude", "workflows", "alpha.js"),
      path.join(projWorkflows, "alpha.js"),
    );
  });
  afterAll(() => env.dispose());

  test("project alpha shadows user alpha (scope:project)", async () => {
    await characterize(env, "shadow-show-alpha-json.txt", ["show", "alpha", "--json"]);
  });
});

// ---- run surface: the runner-demo fixture set against fake backends ----
describe("run surface (fake backends)", () => {
  let env: FixtureEnv;
  beforeAll(() => {
    env = makeEnv(path.join(FIXTURES, "run-home", ".claude", "workflows"));
  });
  afterAll(() => env.dispose());

  const fakeBins = ["--claude-bin", FAKE_CLAUDE, "--codex-bin", FAKE_CODEX];

  // The runner-demo result (stdout) is deterministic: it exercises parallel()
  // null-on-throw, pipeline() per-item stages, gate() on the opposite backend,
  // and a nested workflow(). stderr ordering interleaves nondeterministically, so
  // it is asserted structurally below, not byte-snapshotted.
  test("object-result -> pretty JSON on stdout only (exit 0)", async () => {
    const result = await characterize(
      env,
      "run-runner-demo-stdout.txt",
      ["run", "runner-demo", ...fakeBins],
      { includeStdout: true, includeStderr: false },
    );
    // Structural stderr checks (order-independent): banner + opposite-backend gate.
    expect(result.stderr).toContain("[workflow] backend=claude concurrency=");
    expect(result.stderr).toContain("gate start [codex]");
    expect(result.stderr).toContain("gate done [codex]");
  });

  test("string-result -> raw stdout (mutating workflow w/ --allow-mutating)", async () => {
    await characterize(
      env,
      "run-mutator-allowed.txt",
      ["run", "mutator", "--claude-bin", FAKE_CLAUDE, "--allow-mutating"],
      { includeStdout: true, includeStderr: false },
    );
  });

  test("codex orchestrator: gate flips to claude", async () => {
    const result = await characterize(
      env,
      "run-runner-demo-codex.txt",
      ["run", "runner-demo", "--backend", "codex", ...fakeBins],
      { includeStdout: true, includeStderr: false },
    );
    expect(result.stderr).toContain("[workflow] backend=codex concurrency=");
    expect(result.stderr).toContain("gate start [claude]");
  });

  test("mutating refusal without --allow-mutating -> exit 1", async () => {
    await characterize(
      env,
      "run-mutator-refused.txt",
      ["run", "mutator", "--claude-bin", FAKE_CLAUDE],
      { includeStdout: true, includeStderr: true },
    );
  });

  test("unknown backend -> exit 1", async () => {
    await characterize(
      env,
      "run-unknown-backend.txt",
      ["run", "runner-demo", "--backend", "gpt", ...fakeBins],
      { includeStdout: true, includeStderr: true },
    );
  });

  test("missing option value -> exit 1 ('Missing value for --model')", async () => {
    await characterize(env, "run-missing-value.txt", ["run", "runner-demo", "--model"], {
      includeStdout: true,
      includeStderr: true,
    });
  });
});

// ---- engine-dependent surface: characterized structurally, NOT byte-snapshotted ----
//
// `loadArgs` does `JSON.parse(raw)`, whose message may change with the JavaScript
// engine. Lock the structure instead: exit 1, banner first, then a non-empty
// error line on stderr.
describe("invalid --args JSON (engine-dependent message, structural check)", () => {
  let env: FixtureEnv;
  beforeAll(() => {
    env = makeEnv(path.join(FIXTURES, "run-home", ".claude", "workflows"));
  });
  afterAll(() => env.dispose());

  test("exit 1 with banner then a non-empty parse error on stderr", async () => {
    const r = await runCli(env, [
      "run", "nested-leaf",
      "--claude-bin", FAKE_CLAUDE, "--codex-bin", FAKE_CODEX,
      "--args", "{bad",
    ]);
    expect(r.code).toBe(1);
    const lines = r.stderr.trim().split("\n");
    expect(lines[0]).toMatch(/^\[workflow\] backend=claude concurrency=/);
    // Some engine-specific JSON parse error follows the banner.
    expect(lines.slice(1).join("\n").trim().length).toBeGreaterThan(0);
  });
});
