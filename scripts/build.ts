// Packaging build — wraps `bun build --compile` for the single-binary CLI.
//
// Phase 1 proved `node:vm` survives `--compile --bytecode` (see
// test/spike/vm-compile.ts + the `vm-compile` CI job), so this is the path the
// real binary ships on. `--bytecode` forces CJS output, which forbids
// top-level await — the load path (src/cli.ts and everything it imports) must
// keep all async work inside an async main(); enforced by the spike + smoke.
//
// The package.json version is injected via `--define` so the compiled binary
// does not read package.json at startup (matches src/version.ts).
//
// HARD CONSTRAINT: no top-level await here either — work runs inside main().

import pkg from "../package.json" with { type: "json" };

interface BuildOptions {
  entry: string;
  outfile: string;
  bytecode: boolean;
  minify: boolean;
  sourcemap: boolean;
  target?: string;
}

function requireValue(argv: string[], i: number, flag: string): string {
  const value = argv[i];
  if (value === undefined) {
    console.error(`[build] missing value for ${flag}`);
    process.exit(1);
  }
  return value;
}

function parseArgs(argv: string[]): BuildOptions {
  const opts: BuildOptions = {
    entry: "src/cli.ts",
    outfile: "dist/workflow",
    bytecode: true,
    minify: true,
    sourcemap: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--entry":
        opts.entry = requireValue(argv, ++i, arg);
        break;
      case "--outfile":
      case "-o":
        opts.outfile = requireValue(argv, ++i, arg);
        break;
      case "--target":
        opts.target = requireValue(argv, ++i, arg);
        break;
      case "--no-bytecode":
        opts.bytecode = false;
        break;
      case "--no-minify":
        opts.minify = false;
        break;
      case "--sourcemap":
        opts.sourcemap = true;
        break;
      default:
        // tolerate unknown flags rather than aborting a build
        console.error(`[build] ignoring unknown arg: ${arg}`);
    }
  }
  return opts;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  const cmd = [
    "bun",
    "build",
    "--compile",
    ...(opts.minify ? ["--minify"] : []),
    ...(opts.bytecode ? ["--bytecode"] : []),
    ...(opts.sourcemap ? ["--sourcemap"] : []),
    ...(opts.target ? ["--target", opts.target] : []),
    "--define",
    `WORKFLOW_VERSION=${JSON.stringify(pkg.version)}`,
    "--outfile",
    opts.outfile,
    opts.entry,
  ];

  console.error(`[build] ${cmd.join(" ")}`);
  const proc = Bun.spawn(cmd, { stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) {
    console.error(`[build] FAILED (exit ${code})`);
    process.exit(code || 1);
  }
  console.error(`[build] ok -> ${opts.outfile} (v${pkg.version})`);
}

main().catch((error) => {
  console.error("[build] FAILED:", error);
  process.exit(1);
});
