// Shared type skeleton for the workflow runner. Filled in as features land
// across later phases (discovery, loader, runtime, journal). Phase 0 only needs
// the CLI-surface shapes.

/** Parsed top-level CLI invocation: optional global --cwd, a command, and the
 * remaining args handed to that command's own parser. */
export interface RootInvocation {
  cwd: string;
  command: string | null;
  args: string[];
}
