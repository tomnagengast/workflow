// Version is the single source of truth via package.json.
//
// In dev (`bun run src/cli.ts`) we read it from package.json at startup.
// In the compiled binary we inject it at build time with
// `bun build --define WORKFLOW_VERSION='"x.y.z"'`, so the constant below is
// replaced inline and package.json is not read on the load path.
//
// The `declare const` keeps TypeScript happy without a runtime global; the
// `typeof` guard lets the dev path fall back to package.json when the define
// was not applied.
declare const WORKFLOW_VERSION: string | undefined;

import pkg from "../package.json" with { type: "json" };

export const version: string =
  typeof WORKFLOW_VERSION === "string" ? WORKFLOW_VERSION : pkg.version;
