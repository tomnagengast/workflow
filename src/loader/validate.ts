// Loader validation — real AST parse (Phase 6).
//
// Ported in spirit from the monolith's `validateSource`
// (`/Users/tom/cmptr/bin/workflow` ~219-243), whose own comment notes it is a
// REGEX HEURISTIC of the binary's acorn-based loader checks. Phase 6 replaces
// that heuristic with the real acorn parse the binary always used, catching the
// same three classes of violation by AST node type instead of by scrubbed-string
// token scan:
//   - size cap (512 KiB),
//   - first statement must be `export const meta = { ... }`
//     (ExportNamedDeclaration → VariableDeclaration `const` → single declarator
//     `meta` initialized with an ObjectExpression),
//   - banned non-deterministic constructs: `Date.now()` / `Math.random()` calls
//     and argless `new Date()`.
//
// Why acorn (Q1 in the plan): `Bun.Transpiler.scan()` only surfaces
// imports/exports — it cannot reject `Date.now`/`Math.random`/`new Date()` by
// node type. The plan's documented last resort is acorn, the same parser the
// original binary's loader used; it compiles + runs clean under
// `bun build --compile --bytecode` (verified, Phase 6 gate). Keeping the
// dependency surface minimal: acorn only, no acorn-walk (a tiny hand walk).
//
// Accept-set contract: this AST validator must remain a SUPERSET of the Phase 5
// regex accept-set (test/compat asserts AST accept-set ⊇ snapshot). Error
// messages are kept byte-identical to the monolith so characterization snapshots
// that surface a validation error (none today) would still match.
//
// `list` / `show` do not call this (read-only); `run` (Phase 3) and the new
// `validate` command (Phase 6) do. No top-level await.

import { parse } from "acorn";
import type { Node } from "acorn";

/** 512 KiB source cap (`_$` / SOURCE_LIMIT in the original binary). */
export const SOURCE_LIMIT = 524288;

/** A reusable banned-construct label (matches the monolith's strings). */
type BannedLabel = "Date.now()" | "Math.random()" | "argless new Date()";

/** Minimal structural shapes for the AST nodes we inspect. acorn types nodes as
 * the generic `Node`; we narrow by `.type` at each check. */
interface AnyNode extends Node {
  type: string;
  [key: string]: unknown;
}

/** Is `node` a `MemberExpression` reading `<object>.<property>` (non-computed)? */
function memberOf(node: AnyNode, objectName: string, propertyName: string): boolean {
  if (node.type !== "MemberExpression") return false;
  if (node.computed) return false;
  const object = node.object as AnyNode | undefined;
  const property = node.property as AnyNode | undefined;
  return (
    object?.type === "Identifier" &&
    object.name === objectName &&
    property?.type === "Identifier" &&
    property.name === propertyName
  );
}

/** Walk the whole program tree, collecting any banned non-deterministic
 * constructs encountered (in source order). A plain recursive descent over every
 * child node/array — no acorn-walk dependency. */
function collectBanned(program: AnyNode): BannedLabel[] {
  const found = new Set<BannedLabel>();

  const visit = (node: AnyNode): void => {
    if (node.type === "CallExpression") {
      const callee = node.callee as AnyNode | undefined;
      if (callee) {
        if (memberOf(callee, "Date", "now")) found.add("Date.now()");
        else if (memberOf(callee, "Math", "random")) found.add("Math.random()");
      }
    } else if (node.type === "NewExpression") {
      const callee = node.callee as AnyNode | undefined;
      const args = (node.arguments as AnyNode[] | undefined) ?? [];
      if (callee?.type === "Identifier" && callee.name === "Date" && args.length === 0) {
        found.add("argless new Date()");
      }
    }

    for (const key of Object.keys(node)) {
      if (key === "type" || key === "start" || key === "end") continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === "object" && typeof (item as AnyNode).type === "string") {
            visit(item as AnyNode);
          }
        }
      } else if (child && typeof child === "object" && typeof (child as AnyNode).type === "string") {
        visit(child as AnyNode);
      }
    }
  };

  visit(program);
  // Preserve the monolith's banned-label ordering (Date.now, Math.random,
  // argless new Date()) regardless of source order, so the error text matches.
  const order: BannedLabel[] = ["Date.now()", "Math.random()", "argless new Date()"];
  return order.filter((label) => found.has(label));
}

/** Is `stmt` the required `export const meta = { ... }` first statement? */
function isMetaFirstStatement(stmt: AnyNode | undefined): boolean {
  if (!stmt || stmt.type !== "ExportNamedDeclaration") return false;
  const decl = stmt.declaration as AnyNode | undefined;
  if (!decl || decl.type !== "VariableDeclaration" || decl.kind !== "const") return false;
  const declarations = (decl.declarations as AnyNode[] | undefined) ?? [];
  if (declarations.length !== 1) return false;
  const first = declarations[0]!;
  const id = first.id as AnyNode | undefined;
  const init = first.init as AnyNode | undefined;
  return id?.type === "Identifier" && id.name === "meta" && init?.type === "ObjectExpression";
}

/** Throw a descriptive Error if the script violates the loader contract: too
 * large, not meta-first, or contains a banned non-deterministic construct. AST
 * parse replaces the monolith's regex heuristic; error messages are unchanged. */
export function validateSource(script: string, filePath: string): void {
  if (Buffer.byteLength(script, "utf8") > SOURCE_LIMIT) {
    throw new Error(`Workflow ${filePath} exceeds ${SOURCE_LIMIT} bytes`);
  }

  let program: AnyNode;
  try {
    // The runtime drops the `export` keyword and wraps the whole body in an
    // `(async () => { … })()` IIFE before `vm.runInContext` (see
    // loader/transform.ts + the monolith ~537/562). So a workflow body legally
    // contains top-level `return` and `await` even though the file keeps its
    // module-level `export const meta`. We parse the SAME shape the runtime runs:
    // `sourceType: "module"` to honor the `export`, plus return/await-outside-
    // function tolerance to model the async-IIFE wrap. (The monolith's regex
    // heuristic never parsed, so it tolerated these; a strict module parse would
    // wrongly reject every real workflow on its first `return`.)
    program = parse(script, {
      ecmaVersion: "latest",
      sourceType: "module",
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      allowHashBang: true,
    }) as unknown as AnyNode;
  } catch (error) {
    // A syntax error means the file cannot be a valid workflow. Surface acorn's
    // message framed by the file path so the failure is actionable.
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Workflow ${filePath}: parse error: ${message}`);
  }

  const body = (program.body as AnyNode[] | undefined) ?? [];
  if (!isMetaFirstStatement(body[0])) {
    throw new Error(
      `Workflow ${filePath}: first statement must be \`export const meta = { ... }\``,
    );
  }

  const banned = collectBanned(program);
  if (banned.length) {
    throw new Error(
      `Workflow ${filePath}: banned non-deterministic construct(s): ${banned.join(", ")} (would break resume)`,
    );
  }
}
