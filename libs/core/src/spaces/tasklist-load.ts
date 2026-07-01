import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { parseFrontmatter } from './frontmatter.js';
import type { Space } from './load.js';

export interface TaskNode {
  id: string;
  instruction: string; // body of the .md file
  output: Record<string, string>; // JSON-schema-ish: field -> type
  input?: Record<string, string>; // JSON-schema-ish: field -> type
  dependsOn?: string[];
  condition?: string; // DSL expression
  optional?: boolean;
  goal?: boolean;
  /** Fork capability profile for this task's subagent (default 'general' when omitted).
   *  Read-only roles ('explore'/'plan') cannot write files or run mutating shell. */
  role?: 'explore' | 'plan' | 'general';
  /** Allowlist of space-function names available to this task's fork. When set, only these
   *  functions are injected + listed in the prompt (least privilege); omit for all. */
  functions?: string[];
  /** Host-driven fan-out: "<upstreamTaskId>.<field>" (or bare "<upstreamTaskId>") naming an
   *  upstream array. The host runs this task once per element, in parallel, and collects the
   *  resolved values into an array. The element is injected into each fork as `item` (+ `index`). */
  forEach?: string;
  /** Per-task delegation allowlist: `"space/agent"` (any action) or `"space/agent#action"`.
   *  When set, the task's fork may `delegate()` to exactly these targets (and nothing else). */
  canDelegateTo?: string[];
  /** Host-executed TS statements (YAML block scalar) run in the fork VM BEFORE the model's
   *  first turn — the task's deterministic setup (bindings, webSearch/webFetch gathering)
   *  executes with host reliability instead of being re-emitted by the model. Yields are
   *  allowed; failures degrade per-statement (never kill the fork). Deep validation happens
   *  at run time through the same typecheck pipeline as model statements. */
  prelude?: string;
}

export async function loadTasklist(dir: string, files: string[]): Promise<Record<string, TaskNode>> {
  const tasks: Record<string, TaskNode> = {};

  for (const filePath of files) {
    const raw = await readFile(filePath, 'utf8');
    const { data, body } = parseFrontmatter(raw, filePath);

    // Derive ID from filename (strip numeric prefix and .md)
    const filename = basename(filePath, '.md');
    // Remove leading numeric prefix like "01-" or "001_"
    const id = data['id']
      ? String(data['id'])
      : filename.replace(/^\d+[-_]?/, '') || filename;

    const output: Record<string, string> = {};
    if (data['output'] && typeof data['output'] === 'object' && !Array.isArray(data['output'])) {
      for (const [k, v] of Object.entries(data['output'] as Record<string, unknown>)) {
        output[k] = String(v);
      }
    }

    const task: TaskNode = {
      id,
      instruction: body.trim(),
      output,
    };

    if (data['input'] && typeof data['input'] === 'object' && !Array.isArray(data['input'])) {
      const input: Record<string, string> = {};
      for (const [k, v] of Object.entries(data['input'] as Record<string, unknown>)) {
        input[k] = String(v);
      }
      task.input = input;
    }

    if (Array.isArray(data['dependsOn'])) {
      task.dependsOn = data['dependsOn'].map(String);
    }
    if (typeof data['condition'] === 'string') {
      task.condition = data['condition'];
    }
    if (data['optional'] === true) {
      task.optional = true;
    }
    if (data['goal'] === true) {
      task.goal = true;
    }
    if (data['role'] === 'explore' || data['role'] === 'plan' || data['role'] === 'general') {
      task.role = data['role'];
    }
    if (Array.isArray(data['functions'])) {
      task.functions = data['functions'].map(String);
    }
    if (typeof data['forEach'] === 'string' && data['forEach'].trim()) {
      task.forEach = data['forEach'].trim();
    }
    if (Array.isArray(data['canDelegateTo'])) {
      task.canDelegateTo = data['canDelegateTo'].map(String);
    }
    if (data['prelude'] !== undefined) {
      // Light load-time validation only (non-empty string). Deep validation is
      // deferred to run time, where each statement goes through the same
      // typecheck pipeline as model statements (see exec/prelude.ts).
      if (typeof data['prelude'] !== 'string' || !data['prelude'].trim()) {
        throw new Error(
          `Task "${id}" (${filePath}): "prelude" must be a non-empty string of TypeScript statements`,
        );
      }
      task.prelude = data['prelude'];
    }

    tasks[id] = task;
  }

  return tasks;
}

/**
 * Load a tasklist by name from the space.
 */
export async function loadTasklistFromSpace(space: Space, name: string): Promise<Record<string, TaskNode>> {
  const tasklistDir = space.tasklists[name];
  if (!tasklistDir) {
    throw new Error(`Tasklist "${name}" not found in space at "${space.dir}"`);
  }
  return loadTasklist(tasklistDir.slug, tasklistDir.files);
}
