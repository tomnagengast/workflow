// WorkflowRunner — the execution heart.
//
// Drives a workflow body in a vm sandbox against the agent backends. Key
// contracts:
//   - shared Semaphore across ALL agent()/gate()/action() calls (FIFO).
//   - budget is a hard ceiling: an exhausted dispatch THROWS BudgetError.
//   - backend, process, and host-action failures THROW WorkflowStepError; a
//     valid backend result, including null, remains a successful result.
//   - gate() ALWAYS injected (top-level AND nested); defaults to the OPPOSITE backend.
//   - action() ALWAYS injected (top-level AND nested); executes one fixed
//     executable+argv operation without an implicit shell.
//   - the configured model belongs to the selected backend; opposite-backend
//     gates use that backend's default model.
//   - parallel(): barrier; a thrown thunk -> null (runtime failures re-thrown).
//   - pipeline(): variadic per-item stages, no barrier; a thrown stage -> null
//     for that item (runtime failures re-thrown).
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
import { actionIdentity, actionKey } from "./actionKey.ts";
import { Semaphore } from "./concurrency.ts";
import { BudgetError, makeBudget } from "./budget.ts";
import { WorkflowStepError } from "./failures.ts";
import {
  normalizeHostActionSpec,
  runHostAction,
  type HostActionResult,
  type NormalizedHostActionSpec,
} from "./hostAction.ts";
import { buildSandboxBag, runInSandbox } from "./sandbox.ts";
import { buildAgentPrompt, buildGatePrompt, GATE_SCHEMA, opposite } from "./prompts.ts";
import {
  buildHumanGateIdentity,
  buildReviewerGatePrompt,
  gateReviewer,
  HumanGateSuspended,
} from "./gates.ts";
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
  actionOccurrences: Map<string, number>;
  inFlight: Set<Promise<unknown>>;
  pendingHumanGate: HumanGateSuspended | null;

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
    this.actionOccurrences = new Map();
    this.inFlight = new Set();
    this.pendingHumanGate = null;
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
      type: this.journalStream.continued ? "runtime.resumed" : "runtime.started",
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
        action: (spec) => this.action(workflow, spec),
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
      if (error instanceof HumanGateSuspended) {
        await Promise.allSettled(this.inFlight);
        this.journal({
          type: "runtime.suspended",
          workflow: error.request.workflow,
          phase: error.request.phase,
          stepId: error.request.stepId,
          key: error.request.key,
          agentId: error.request.agentId,
          backend: "human",
          kind: "gate",
          message: error.request.prompt,
          schema: error.request.schema,
          tokens: this.spent,
        });
        throw error;
      }
      await Promise.allSettled(this.inFlight);
      this.journal({
        type: "runtime.failed",
        workflow: workflow.name,
        phase: this.phaseTitle,
        error: error instanceof Error ? error.message : String(error),
        errorCode: error instanceof WorkflowStepError ? error.code : undefined,
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
      const failure = new WorkflowStepError({
        code: "backend-unavailable",
        stepKind: kind as "agent" | "gate",
        message: error,
      });
      this.journal({
        type: "step.failed", workflow: workflow.name, phase: phaseTitle, stepId,
        key, agentId: label, backend: backendName, kind, message: framedPrompt,
        error, errorCode: failure.code,
      });
      console.error(`[workflow:${workflow.name}] ${kind} FAILED: ${error}`);
      throw failure;
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
      const detail = error instanceof Error ? error.message : String(error);
      const failure = error instanceof WorkflowStepError
        ? error
        : new WorkflowStepError({
          code: "backend-failed",
          stepKind: kind as "agent" | "gate",
          message: `${backendName} ${kind} failed: ${detail}`,
          cause: error,
        });
      console.error(`[workflow:${workflow.name}] ${kind} FAILED: ${label}: ${failure.message}`);
      this.journal({
        type: "step.failed", workflow: workflow.name, phase: phaseTitle, stepId,
        key, agentId: label, backend: backendName, kind,
        error: failure.message, errorCode: failure.code,
      });
      throw failure;
    } finally {
      this.sem.release();
    }
  }

  async agent(workflow: WorkflowRow, prompt: string, opts: Record<string, unknown> = {}): Promise<unknown> {
    const phaseTitle = (opts.phase as string) || this.phaseTitle;
    const framed = buildAgentPrompt({ workflow, phaseTitle, label: (opts.label as string) || "agent", prompt, schema: opts.schema });
    return this.track(this._dispatch(workflow, this.runtime.backend, framed, opts, "agent"));
  }

  // Gates default to the opposite backend. A workflow may pin a backend or
  // suspend for a durable human response.
  async gate(workflow: WorkflowRow, prompt: string, opts: Record<string, unknown> = {}): Promise<unknown> {
    const reviewer = gateReviewer(opts.reviewer);
    const schema = reviewer === "human" ? opts.schema : (opts.schema || GATE_SCHEMA);
    const phaseTitle = (opts.phase as string) || this.phaseTitle;
    if (reviewer === "human") {
      return this.humanGate(workflow, prompt, { ...opts, schema }, phaseTitle);
    }
    const backendName = reviewer === "agent" ? opposite(this.runtime.backend) : reviewer;
    const framed = reviewer === "agent"
      ? buildGatePrompt({ workflow, backendName, phaseTitle, prompt, schema })
      : buildReviewerGatePrompt({ workflow, backendName: reviewer, phaseTitle, prompt, schema });
    return this.track(this._dispatch(workflow, backendName, framed, { ...opts, schema }, "gate"));
  }

  async humanGate(
    workflow: WorkflowRow,
    prompt: string,
    opts: Record<string, unknown>,
    phaseTitle: string,
  ): Promise<unknown> {
    if (this.pendingHumanGate) throw this.pendingHumanGate;
    const label = (opts.label as string) || "gate";
    const schema = opts.schema;
    const identity = buildHumanGateIdentity({ workflow, phaseTitle, prompt, schema });
    const key = agentKey(identity, opts);
    const stepId = ++this.nextStepId;
    if (this.cache.has(key)) {
      const result = this.cache.get(key);
      this.journal({
        type: "step.cached", workflow: workflow.name, phase: phaseTitle, stepId,
        key, agentId: label, backend: "human", kind: "gate", message: prompt, schema, result,
      });
      console.error(`[workflow:${workflow.name}] gate cached [human]: ${phaseTitle ? `${phaseTitle}:` : ""}${label}`);
      return result;
    }
    this.journal({
      type: "step.started", workflow: workflow.name, phase: phaseTitle, stepId,
      key, agentId: label, backend: "human", kind: "gate", message: prompt, schema,
    });
    const suspended = new HumanGateSuspended({
      workflow: workflow.name,
      phase: phaseTitle,
      stepId,
      key,
      agentId: label,
      prompt,
      schema,
    });
    this.pendingHumanGate = suspended;
    throw suspended;
  }

  async action(workflow: WorkflowRow, value: unknown): Promise<unknown> {
    return this.track(this._action(workflow, value));
  }

  async _action(workflow: WorkflowRow, value: unknown): Promise<HostActionResult> {
    const stepId = ++this.nextStepId;
    const phase = this.phaseTitle;
    let spec: NormalizedHostActionSpec;
    try {
      spec = normalizeHostActionSpec(value, this.cwd);
    } catch (error) {
      const failure = error instanceof WorkflowStepError
        ? error
        : new WorkflowStepError({
          code: "action-invalid",
          stepKind: "action",
          message: error instanceof Error ? error.message : String(error),
          cause: error,
        });
      this.journal({
        type: "step.failed",
        workflow: workflow.name,
        phase,
        stepId,
        agentId: "action",
        backend: "host",
        kind: "action",
        error: failure.message,
        errorCode: failure.code,
      });
      throw failure;
    }

    const identity = actionIdentity({ workflowPath: workflow.path, spec });
    const occurrence = (this.actionOccurrences.get(identity) ?? 0) + 1;
    this.actionOccurrences.set(identity, occurrence);
    const key = actionKey(identity, occurrence);
    const agentId = spec.executable;
    const message = JSON.stringify({
      executable: spec.executable,
      arguments: spec.arguments,
      cwd: spec.cwd,
      stdinBytes: spec.stdin === undefined ? 0 : Buffer.byteLength(spec.stdin),
      timeoutMs: spec.timeoutMs,
    });
    if (this.cache.has(key)) {
      const result = this.cache.get(key) as HostActionResult;
      this.journal({
        type: "step.cached",
        workflow: workflow.name,
        phase,
        stepId,
        key,
        agentId,
        backend: "host",
        kind: "action",
        message,
        result,
      });
      console.error(`[workflow:${workflow.name}] action cached: ${phase ? `${phase}:` : ""}${agentId}`);
      return result;
    }

    this.journal({
      type: "step.started",
      workflow: workflow.name,
      phase,
      stepId,
      key,
      agentId,
      backend: "host",
      kind: "action",
      message,
    });

    let acquired = false;
    try {
      await this.sem.acquire(this.runtime.signal);
      acquired = true;
      console.error(`[workflow:${workflow.name}] action start [host]: ${phase ? `${phase}:` : ""}${agentId}`);
      const result = await runHostAction(spec, this.runtime.signal);
      this.cache.set(key, result);
      this.journal({
        type: "step.completed",
        workflow: workflow.name,
        phase,
        stepId,
        key,
        agentId,
        backend: "host",
        kind: "action",
        result,
      });
      console.error(`[workflow:${workflow.name}] action done [host]: ${phase ? `${phase}:` : ""}${agentId}`);
      return result;
    } catch (error) {
      const failure = error instanceof WorkflowStepError
        ? error
        : new WorkflowStepError({
          code: this.runtime.signal?.aborted ? "action-cancelled" : "action-launch-failed",
          stepKind: "action",
          message: this.runtime.signal?.aborted
            ? `action cancelled: ${spec.executable}`
            : `action failed: ${spec.executable}: ${error instanceof Error ? error.message : String(error)}`,
          cause: error,
        });
      this.journal({
        type: "step.failed",
        workflow: workflow.name,
        phase,
        stepId,
        key,
        agentId,
        backend: "host",
        kind: "action",
        result: failure.result,
        error: failure.message,
        errorCode: failure.code,
      });
      console.error(`[workflow:${workflow.name}] action FAILED: ${failure.message}`);
      throw failure;
    } finally {
      if (acquired) this.sem.release();
    }
  }

  async track(promise: Promise<unknown>): Promise<unknown> {
    this.inFlight.add(promise);
    try {
      return await promise;
    } finally {
      this.inFlight.delete(promise);
    }
  }

  // barrier: generic user exceptions become null; runtime failures reject.
  async parallel(thunks: unknown): Promise<unknown> {
    if (!Array.isArray(thunks) || thunks.some((t) => typeof t !== "function")) {
      throw new Error("parallel() expects an array of functions");
    }
    return Promise.all((thunks as Array<() => unknown>).map((t) => Promise.resolve().then(t).catch((e) => {
      if (
        e instanceof BudgetError ||
        e instanceof HumanGateSuspended ||
        e instanceof WorkflowStepError
      ) throw e;
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
          if (
            e instanceof BudgetError ||
            e instanceof HumanGateSuspended ||
            e instanceof WorkflowStepError
          ) throw e;
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
      if (error instanceof HumanGateSuspended) throw error;
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
      action: (spec) => this.action(workflow, spec),
      parallel: (thunks) => this.parallel(thunks),
      pipeline: (items, ...stages) => this.pipeline(items, stages),
      workflow: (n, a) => this.workflow(n, a),
    });
    return runInSandbox(wrapped, bag, workflow.path, this.runtime.vmTimeoutMs);
  }
}
