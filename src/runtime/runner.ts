// WorkflowRunner — the execution heart.
//
// Byte-faithful to the monolith's `WorkflowRunner` (`/Users/tom/cmptr/bin/
// workflow` ~505-690). Drives a workflow body in a vm sandbox against the agent
// backends. Key contracts preserved exactly:
//   - shared Semaphore across ALL agent()/gate() calls (FIFO).
//   - budget is a hard ceiling: an exhausted dispatch THROWS BudgetError (not
//     null); a dead subagent (after retries) returns null (callers .filter(Boolean)).
//   - gate() ALWAYS injected (top-level AND nested); runs on the OPPOSITE backend.
//   - the configured model belongs to the selected backend; opposite-backend
//     gates use that backend's default model.
//   - parallel(): barrier; a thrown thunk -> null (BudgetError re-thrown).
//   - pipeline(): variadic per-item stages, no barrier; a thrown stage -> null
//     for that item (BudgetError re-thrown).
//   - workflow(): nested dispatch, sharing this run's sem/budget/cache/journal.
//   - cache: resume cache pre-seeded; a cache hit short-circuits dispatch.
//   - journal: every semantic runtime observation is appended in one ordered
//     stream before execution continues.
//   - the entrypoint is async-wrapped; NO top-level await anywhere on this path.
//
// agentKey, the prompt framing, the transform, the sandbox bag, the Semaphore,
// and the budget bag are imported as their (frozen where noted) modules.

import fs from "node:fs";
import path from "node:path";
import type { Catalog, Runtime, WorkflowRow } from "../types.ts";
import { extractMetaObject, parseWorkflow } from "../loader/meta.ts";
import { transformSource } from "../loader/transform.ts";
import { validateSource } from "../loader/validate.ts";
import { requireWorkflow } from "../discovery/resolve.ts";
import { BACKENDS } from "../backends/index.ts";
import { agentKey } from "./agentKey.ts";
import { Semaphore } from "./concurrency.ts";
import { BudgetError, makeBudget } from "./budget.ts";
import { buildSandboxBag, runInSandbox } from "./sandbox.ts";
import { buildAgentPrompt, buildGatePrompt, GATE_SCHEMA, opposite } from "./prompts.ts";
import { Journal, type JournalEventInput } from "../journal/journal.ts";

export class WorkflowRunner {
  cwd: string;
  workflows: Catalog;
  runtime: Runtime;
  phaseTitle: string;
  sem: Semaphore;
  spent: number;
  cache: Map<string, unknown>;
  journalStream: Journal;
  nextStepId: number;

  constructor({ cwd, workflows, runtime }: { cwd: string; workflows: Catalog; runtime: Runtime }) {
    this.cwd = cwd;
    this.workflows = workflows;
    this.runtime = runtime;
    this.phaseTitle = "";
    this.sem = new Semaphore(runtime.concurrency);
    this.spent = 0;
    this.cache = runtime.resumeCache || new Map();
    this.journalStream = new Journal(runtime.journalPath);
    this.nextStepId = 0;
  }

  journal(event: JournalEventInput): void {
    this.journalStream.write(event);
  }

  phase(workflow: WorkflowRow, title: unknown): void {
    this.phaseTitle = String(title);
    this.journal({
      type: "phase.started",
      workflow: workflow.name,
      phase: this.phaseTitle,
    });
    console.error(`\n[workflow:${workflow.name}] phase: ${this.phaseTitle}`);
  }

  log(workflow: WorkflowRow, message: unknown): void {
    const text = String(message);
    this.journal({
      type: "log",
      workflow: workflow.name,
      phase: this.phaseTitle,
      message: text,
    });
    console.error(`[workflow:${workflow.name}] ${text}`);
  }

  diagnostic(workflow: WorkflowRow, message: string, phase: string): void {
    this.journal({
      type: "diagnostic",
      workflow: workflow.name,
      phase,
      message,
    });
    console.error(`[workflow:${workflow.name}] ${message}`);
  }

  makeBudget() {
    const total = this.runtime.budget;
    return makeBudget(total, () => this.spent);
  }

  async run(workflow: WorkflowRow, argsValue: unknown): Promise<unknown> {
    this.journal({
      type: "runtime.started",
      workflow: workflow.name,
      backend: this.runtime.backend,
      concurrency: this.runtime.concurrency,
      budget: this.runtime.budget,
    });
    try {
      const script = fs.readFileSync(workflow.path, "utf8");
      if (!this.runtime.noValidate) validateSource(script, workflow.path);
      const extracted = extractMetaObject(script);
      if (!extracted) throw new Error(`Workflow ${workflow.path} does not start with export const meta`);
      const wrapped = transformSource(script, extracted);
      const bag = buildSandboxBag({
        args: argsValue,
        budget: this.makeBudget(),
        phase: (title) => this.phase(workflow, title),
        log: (message) => this.log(workflow, message),
        agent: (prompt, opts = {}) => this.agent(workflow, prompt, opts),
        gate: (prompt, opts = {}) => this.gate(workflow, prompt, opts),
        parallel: (thunks) => this.parallel(thunks),
        pipeline: (items, ...stages) => this.pipeline(items, stages),
        workflow: (nameOrSpec, nestedArgs) => this.workflow(nameOrSpec, nestedArgs),
      });
      const result = await runInSandbox(wrapped, bag, workflow.path, this.runtime.vmTimeoutMs);
      this.journal({
        type: "runtime.completed",
        workflow: workflow.name,
        phase: this.phaseTitle,
        result,
        tokens: this.spent,
      });
      return result;
    } catch (error) {
      this.journal({
        type: "runtime.failed",
        workflow: workflow.name,
        phase: this.phaseTitle,
        error: error instanceof Error ? error.message : String(error),
        tokens: this.spent,
      });
      throw error;
    } finally {
      await this.journalStream.end();
    }
  }

  // shared dispatch for agent() (orchestrator backend) and gate() (opposite backend)
  async _dispatch(
    workflow: WorkflowRow,
    backendName: string,
    framedPrompt: string,
    opts: Record<string, unknown>,
    kind: string,
  ): Promise<unknown> {
    const label = (opts.label as string) || kind;
    const phaseTitle = (opts.phase as string) || this.phaseTitle;
    const key = agentKey(framedPrompt, { ...opts, backend: backendName });
    const stepId = ++this.nextStepId;

    if (this.cache.has(key)) {
      const result = this.cache.get(key);
      this.journal({
        type: "step.cached", workflow: workflow.name, phase: phaseTitle, stepId,
        key, agentId: label, backend: backendName, kind, message: framedPrompt, result,
      });
      console.error(`[workflow:${workflow.name}] ${kind} cached: ${phaseTitle ? `${phaseTitle}:` : ""}${label}`);
      return result;
    }
    // budget is a hard ceiling: exhausted calls THROW (not null).
    if (this.runtime.budget != null && this.spent >= this.runtime.budget) {
      const error = `token budget exhausted (${this.spent}/${this.runtime.budget})`;
      this.journal({
        type: "step.failed", workflow: workflow.name, phase: phaseTitle, stepId,
        key, agentId: label, backend: backendName, kind, message: framedPrompt, error,
      });
      throw new BudgetError(error);
    }
    if (opts.agentType) {
      this.diagnostic(workflow, `note: agentType '${opts.agentType}' ignored`, phaseTitle);
    }
    if (opts.isolation === "worktree") {
      this.diagnostic(workflow, "note: isolation 'worktree' is advisory in this runner", phaseTitle);
    }
    if (!BACKENDS[backendName]) {
      const error = `backend '${backendName}' unavailable`;
      this.journal({
        type: "step.failed", workflow: workflow.name, phase: phaseTitle, stepId,
        key, agentId: label, backend: backendName, kind, message: framedPrompt, error,
      });
      console.error(`[workflow:${workflow.name}] ${kind} FAILED (-> null): ${error}`);
      return null;
    }

    this.journal({
      type: "step.started", workflow: workflow.name, phase: phaseTitle, stepId,
      key, agentId: label, backend: backendName, kind, message: framedPrompt,
    });
    await this.sem.acquire();
    try {
      console.error(`[workflow:${workflow.name}] ${kind} start [${backendName}]: ${phaseTitle ? `${phaseTitle}:` : ""}${label}`);
      const runtime = backendName === this.runtime.backend
        ? this.runtime
        : { ...this.runtime, model: undefined };
      const { value, tokens } = await BACKENDS[backendName]!(framedPrompt, opts.schema, runtime);
      this.spent += tokens || 0;
      this.cache.set(key, value);
      this.journal({
        type: "step.completed", workflow: workflow.name, phase: phaseTitle, stepId,
        key, agentId: label, backend: backendName, kind, result: value, tokens,
      });
      console.error(`[workflow:${workflow.name}] ${kind} done [${backendName}]: ${phaseTitle ? `${phaseTitle}:` : ""}${label}`);
      return value;
    } catch (error) {
      // returns null when a subagent dies after retries (callers .filter(Boolean))
      const err = error as Error;
      console.error(`[workflow:${workflow.name}] ${kind} FAILED (-> null): ${label}: ${err.message}`);
      this.journal({
        type: "step.failed", workflow: workflow.name, phase: phaseTitle, stepId,
        key, agentId: label, backend: backendName, kind, result: null,
        error: String(err.message || err),
      });
      return null;
    } finally {
      this.sem.release();
    }
  }

  async agent(workflow: WorkflowRow, prompt: string, opts: Record<string, unknown> = {}): Promise<unknown> {
    const phaseTitle = (opts.phase as string) || this.phaseTitle;
    const framed = buildAgentPrompt({ workflow, phaseTitle, label: (opts.label as string) || "agent", prompt, schema: opts.schema });
    return this._dispatch(workflow, this.runtime.backend, framed, opts, "agent");
  }

  // cross-model gate: always runs on the OPPOSITE backend from the orchestrator (claude<->codex)
  async gate(workflow: WorkflowRow, prompt: string, opts: Record<string, unknown> = {}): Promise<unknown> {
    const backendName = opposite(this.runtime.backend);
    const schema = opts.schema || GATE_SCHEMA;
    const phaseTitle = (opts.phase as string) || this.phaseTitle;
    const framed = buildGatePrompt({ workflow, backendName, phaseTitle, prompt, schema });
    return this._dispatch(workflow, backendName, framed, { ...opts, schema }, "gate");
  }

  // barrier: await all; a thrown thunk resolves to null; the call never rejects.
  async parallel(thunks: unknown): Promise<unknown> {
    if (!Array.isArray(thunks) || thunks.some((t) => typeof t !== "function")) {
      throw new Error("parallel() expects an array of functions");
    }
    return Promise.all((thunks as Array<() => unknown>).map((t) => Promise.resolve().then(t).catch((e) => {
      if (e instanceof BudgetError) throw e;
      return null;
    })));
  }

  // variadic stages, no barrier between them: each item runs its full chain independently and
  // concurrently (throttled by the shared agent semaphore). A thrown stage drops the item to null.
  async pipeline(items: unknown[], stages: unknown[]): Promise<unknown> {
    if (!stages.length || stages.some((s) => typeof s !== "function")) {
      throw new Error("pipeline() stages must be functions: pipeline(items, item => ..., result => ...)");
    }
    return Promise.all(items.map(async (item, index) => {
      let prev: unknown = item;
      for (let s = 0; s < stages.length; s += 1) {
        try {
          prev = await (stages[s] as (prev: unknown, item: unknown, index: number) => unknown)(prev, item, index);
        } catch (e) {
          if (e instanceof BudgetError) throw e;
          return null;
        }
      }
      return prev;
    }));
  }

  async workflow(nameOrSpec: unknown, nestedArgs?: unknown): Promise<unknown> {
    let name: unknown = nameOrSpec;
    let argsValue = nestedArgs;
    if (typeof nameOrSpec === "object" && nameOrSpec !== null) {
      const spec = nameOrSpec as { scriptPath?: string; name?: unknown; args?: unknown };
      if (spec.scriptPath) {
        const nested = parseWorkflow(path.resolve(spec.scriptPath), "scriptPath");
        return this.runWorkflowStep(nested, spec.args);
      }
      name = spec.name;
      argsValue = spec.args;
    }
    if (typeof name !== "string") throw new Error("workflow() expects a workflow name or {scriptPath}");
    return this.runWorkflowStep(requireWorkflow(this.workflows, name), argsValue);
  }

  async runWorkflowStep(workflow: WorkflowRow, argsValue: unknown): Promise<unknown> {
    const stepId = ++this.nextStepId;
    const phase = this.phaseTitle;
    this.journal({
      type: "step.started", workflow: workflow.name, phase, stepId,
      agentId: workflow.name, kind: "workflow",
    });
    try {
      const result = await this.runNested(workflow, argsValue);
      this.journal({
        type: "step.completed", workflow: workflow.name, phase, stepId,
        agentId: workflow.name, kind: "workflow", result,
      });
      return result;
    } catch (error) {
      this.journal({
        type: "step.failed", workflow: workflow.name, phase, stepId,
        agentId: workflow.name, kind: "workflow",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  // nested workflow shares this run's semaphore, budget, cache, and journal
  async runNested(workflow: WorkflowRow, argsValue: unknown): Promise<unknown> {
    const script = fs.readFileSync(workflow.path, "utf8");
    if (!this.runtime.noValidate) validateSource(script, workflow.path);
    const extracted = extractMetaObject(script);
    const wrapped = transformSource(script, extracted!);
    const bag = buildSandboxBag({
      args: argsValue,
      budget: this.makeBudget(),
      phase: (title) => this.phase(workflow, title),
      log: (message) => this.log(workflow, message),
      agent: (prompt, opts = {}) => this.agent(workflow, prompt, opts),
      gate: (prompt, opts = {}) => this.gate(workflow, prompt, opts),
      parallel: (thunks) => this.parallel(thunks),
      pipeline: (items, ...stages) => this.pipeline(items, stages),
      workflow: (n, a) => this.workflow(n, a),
    });
    return runInSandbox(wrapped, bag, workflow.path, this.runtime.vmTimeoutMs);
  }
}
