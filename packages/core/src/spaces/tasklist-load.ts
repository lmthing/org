import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { parseFrontmatter } from './frontmatter.js';
import type { Space } from './load.js';

export interface TaskNode {
  id: string;
  instruction: string; // body of the .md file
  output: Record<string, string>; // JSON-schema-ish: field -> type
  dependsOn?: string[];
  condition?: string; // DSL expression
  optional?: boolean;
  goal?: boolean;
}

export async function loadTasklist(dir: string, files: string[]): Promise<Record<string, TaskNode>> {
  const tasks: Record<string, TaskNode> = {};

  for (const filePath of files) {
    const raw = await readFile(filePath, 'utf8');
    const { data, body } = parseFrontmatter(raw);

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
