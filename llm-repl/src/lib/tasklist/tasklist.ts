import type { QuickJSAsyncContext } from 'quickjs-emscripten';
import type { TraceWriter } from '../sandbox/trace.js';
import type { TaskRecord } from '../../session/types.js';
import { injectGlobal } from '../sandbox/host-bridge.js';

export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'failed' | 'skipped';

export interface TaskNode {
  id: string;
  label: string;
  deps?: string[];
  optional?: boolean;
  condition?: string;
  outputSchema?: unknown;
}

export interface TasklistDag {
  [id: string]: TaskNode;
}

export interface TasklistHandle {
  id: string;
  start(taskId: string): void;
  finish(taskId: string, value?: unknown): void;
  fail(taskId: string): void;
  skip(taskId: string): void;
  status(taskId: string): TaskStatus;
  getAll(): TaskRecord[];
  nudge(): string | null;
}

// ── JSON Schema mini-validator ──

function validateJsonSchema(value: unknown, schema: unknown, path: string): string | null {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) return null;
  const s = schema as Record<string, unknown>;

  if ('type' in s) {
    const expectedType = s['type'] as string;
    const actualType = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    if (actualType !== expectedType) {
      return `${path}: expected type '${expectedType}', got '${actualType}'`;
    }
  }

  if (s['type'] === 'object' && value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;

    if (Array.isArray(s['required'])) {
      for (const req of s['required'] as string[]) {
        if (!(req in obj)) {
          return `${path}: missing required property '${req}'`;
        }
      }
    }

    if (s['properties'] !== null && typeof s['properties'] === 'object') {
      const props = s['properties'] as Record<string, unknown>;
      for (const [key, propSchema] of Object.entries(props)) {
        if (key in obj) {
          const err = validateJsonSchema(obj[key], propSchema, `${path}.${key}`);
          if (err) return err;
        }
      }
    }
  }

  if (s['type'] === 'array' && Array.isArray(value)) {
    if (s['items'] !== undefined) {
      for (let i = 0; i < value.length; i++) {
        const err = validateJsonSchema(value[i], s['items'], `${path}[${i}]`);
        if (err) return err;
      }
    }
  }

  return null;
}

// ── Contract error ──

class ContractError extends Error {
  readonly kind = 'contract' as const;
  constructor(message: string) {
    super(message);
    this.name = 'ContractError';
  }
}

// ── TasklistHandleImpl ──

class TasklistHandleImpl implements TasklistHandle {
  readonly id: string;
  private readonly _dag: TasklistDag;
  private readonly _statuses: Map<string, TaskStatus>;
  private readonly _trace: TraceWriter;
  private readonly _evalFilter: (filterExpr: string, el: unknown) => boolean;

  constructor(
    id: string,
    dag: TasklistDag,
    trace: TraceWriter,
    evalFilter: (filterExpr: string, el: unknown) => boolean,
  ) {
    this.id = id;
    this._dag = dag;
    this._trace = trace;
    this._evalFilter = evalFilter;
    this._statuses = new Map();
    for (const taskId of Object.keys(dag)) {
      this._statuses.set(taskId, 'pending');
    }
  }

  start(taskId: string): void {
    const node = this._dag[taskId];
    if (!node) throw new ContractError(`Unknown task '${taskId}'`);

    const from = this._statuses.get(taskId)!;

    // Check deps
    const blockers: string[] = [];
    for (const dep of node.deps ?? []) {
      if (!this.isDepSatisfied(dep)) {
        blockers.push(dep);
      }
    }
    if (blockers.length > 0) {
      throw new ContractError(
        `Cannot start '${taskId}': deps not done: ${blockers.join(', ')}`,
      );
    }

    // Check condition
    if (node.condition !== undefined) {
      const pass = this._evalFilter(node.condition, {});
      if (!pass) {
        this._statuses.set(taskId, 'skipped');
        this._trace.write({ type: 'task_skip', tasklistId: this.id, id: taskId, condition: node.condition });
        return;
      }
    }

    this._statuses.set(taskId, 'in_progress');
    this._trace.write({
      type: 'tasklist_update',
      tasklistId: this.id,
      id: taskId,
      from,
      to: 'in_progress',
    });
  }

  finish(taskId: string, value?: unknown): void {
    const node = this._dag[taskId];
    if (!node) throw new ContractError(`Unknown task '${taskId}'`);

    const from = this._statuses.get(taskId)!;

    if (node.outputSchema !== undefined && value !== undefined) {
      const err = validateJsonSchema(value, node.outputSchema, taskId);
      if (err) {
        throw new ContractError(`outputSchema mismatch for task '${taskId}': ${err}`);
      }
    }

    this._statuses.set(taskId, 'done');
    this._trace.write({
      type: 'tasklist_update',
      tasklistId: this.id,
      id: taskId,
      from,
      to: 'done',
    });
  }

  fail(taskId: string): void {
    const node = this._dag[taskId];
    if (!node) throw new ContractError(`Unknown task '${taskId}'`);

    const from = this._statuses.get(taskId)!;
    this._statuses.set(taskId, 'failed');
    this._trace.write({
      type: 'tasklist_update',
      tasklistId: this.id,
      id: taskId,
      from,
      to: 'failed',
    });
  }

  skip(taskId: string): void {
    const node = this._dag[taskId];
    if (!node) throw new ContractError(`Unknown task '${taskId}'`);

    const from = this._statuses.get(taskId)!;
    this._statuses.set(taskId, 'skipped');
    this._trace.write({
      type: 'task_skip',
      tasklistId: this.id,
      id: taskId,
      from,
    });
  }

  status(taskId: string): TaskStatus {
    const s = this._statuses.get(taskId);
    if (s === undefined) throw new ContractError(`Unknown task '${taskId}'`);
    return s;
  }

  getAll(): TaskRecord[] {
    return Object.entries(this._dag).map(([taskId, node]) => ({
      tasklistId: this.id,
      id: taskId,
      label: node.label ?? (node as unknown as Record<string, unknown>)['description'] as string ?? taskId,
      status: this._statuses.get(taskId) ?? 'pending',
      deps: node.deps,
      optional: node.optional,
    }));
  }

  nudge(): string | null {
    const records = this.getAll();
    const unfinished = records.filter(
      (r) => r.status === 'pending' || r.status === 'in_progress',
    );
    if (unfinished.length === 0) return null;

    const lines: string[] = [`// ── Tasklist: ${this.id} ──────────────────────────────────────`];
    for (const r of records) {
      const icon = r.status === 'done' || r.status === 'skipped' ? '[✓]' : '[ ]';
      let detail: string = r.status;

      if (r.status === 'pending' && r.deps && r.deps.length > 0) {
        const blocked = r.deps.filter((dep) => !this.isDepSatisfied(dep));
        if (blocked.length > 0) {
          detail = `pending, blocked on: ${blocked.join(', ')}`;
        }
      }

      const label = r.label.padEnd(14);
      lines.push(`// ${icon} ${label} (${detail})`);
    }
    return lines.join('\n');
  }

  /** Check if a dep is effectively unblocked (done, skipped, or optional-failed) */
  isDepSatisfied(depId: string): boolean {
    const depStatus = this._statuses.get(depId);
    if (depStatus === 'done' || depStatus === 'skipped') return true;
    if (depStatus === 'failed') {
      const depNode = this._dag[depId];
      return depNode?.optional === true;
    }
    return false;
  }
}

// ── TasklistEngine ──

export class TasklistEngine {
  private readonly _trace: TraceWriter;
  private readonly _evalFilter: (filterExpr: string, el: unknown) => boolean;
  private readonly _handles: Map<string, TasklistHandleImpl> = new Map();

  constructor(opts: {
    trace: TraceWriter;
    evalFilter: (filterExpr: string, el: unknown) => boolean;
  }) {
    this._trace = opts.trace;
    this._evalFilter = opts.evalFilter;
  }

  register(id: string, dag: TasklistDag): TasklistHandle {
    // If a tasklist with this id is already registered, return the existing
    // handle so task state persists across cycles. Re-calling `tasklist(id, dag)`
    // with the same DAG is the canonical way for the LLM to obtain the handle
    // after a yield — QuickJS top-level `const` bindings don't survive across
    // separate `evalCodeAsync` calls.
    const existing = this._handles.get(id);
    if (existing) {
      this._trace.write({ type: 'tasklist_rebind', tasklistId: id });
      return existing;
    }
    const handle = new TasklistHandleImpl(id, dag, this._trace, this._evalFilter);
    this._handles.set(id, handle);
    this._trace.write({ type: 'tasklist_register', tasklistId: id, tasks: Object.keys(dag) });
    return handle;
  }

  get(id: string): TasklistHandle | undefined {
    return this._handles.get(id);
  }

  getAllNudges(): string | null {
    const parts: string[] = [];
    for (const handle of this._handles.values()) {
      const nudge = handle.nudge();
      if (nudge) parts.push(nudge);
    }
    return parts.length > 0 ? parts.join('\n') : null;
  }

  registerGlobals(ctx: QuickJSAsyncContext): void {
    injectGlobal(ctx, 'tasklist', (id: unknown, dagRaw: unknown) => {
      const dag = dagRaw as TasklistDag;
      const handle = this.register(id as string, dag);

      // Return a plain object that the sandbox can call methods on
      return {
        id: handle.id,
        start: (taskId: unknown) => handle.start(taskId as string),
        finish: (taskId: unknown, value?: unknown) => handle.finish(taskId as string, value),
        fail: (taskId: unknown) => handle.fail(taskId as string),
        skip: (taskId: unknown) => handle.skip(taskId as string),
        status: (taskId: unknown) => handle.status(taskId as string),
        getAll: () => handle.getAll(),
        nudge: () => handle.nudge(),
      };
    });
  }
}
