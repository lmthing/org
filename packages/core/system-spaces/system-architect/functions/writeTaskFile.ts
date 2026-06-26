/** Join path segments with '/'. Replaces node:path.join inside the QuickJS VM. */
function joinPath(...parts: string[]): string {
  return parts
    .map((p, i) => (i === 0 ? p.replace(/\/+$/, '') : p.replace(/^\/+|\/+$/g, '')))
    .filter(Boolean)
    .join('/');
}

interface TaskFileSpec {
  id: string;
  instruction: string;
  /** Map of output field name → type string, e.g. { answer: 'string', found: 'boolean' }. */
  output: Record<string, string>;
  dependsOn?: string[];
  goal?: boolean;
  optional?: boolean;
  condition?: string;
  /** Force a specific 1-based ordinal; otherwise reuse the existing one for this id or append. */
  ordinal?: number;
}

/**
 * Write a single tasklist task file `tasklists/<tasklist>/NN-<id>.md`. The ordinal is
 * derived automatically: if a file already ends in `-<id>.md`, its ordinal is reused
 * (so re-writing a task is idempotent); otherwise the task is appended after the
 * highest existing ordinal. Pass `spec.ordinal` to force a position.
 *
 * Exactly one task per tasklist should set `goal: true` (the task whose output is the
 * final answer); `validateSpace` enforces this. Uses execShell (ls) + writeFileRaw. No imports.
 *
 * @returns { ok, path, error? }
 */
export function writeTaskFile(
  dir: string,
  tasklist: string,
  spec: TaskFileSpec,
): { ok: boolean; path: string; error?: string } {
  if (!tasklist) return { ok: false, path: '', error: 'writeTaskFile: tasklist name is required' };
  if (!spec || typeof spec !== 'object' || !spec.id) {
    return { ok: false, path: '', error: 'writeTaskFile: spec.id is required' };
  }
  if (typeof spec.instruction !== 'string' || spec.instruction.trim() === '') {
    return { ok: false, path: '', error: 'writeTaskFile: spec.instruction must be a non-empty string' };
  }
  if (!spec.output || typeof spec.output !== 'object' || Array.isArray(spec.output) || Object.keys(spec.output).length === 0) {
    return { ok: false, path: '', error: 'writeTaskFile: spec.output must be a non-empty object of field:type' };
  }

  const id = String(spec.id).replace(/^\d+[-_]?/, '').replace(/\.md$/i, '') || 'task';
  const tlDir = joinPath(dir, 'tasklists', tasklist);

  // Determine the ordinal. List existing task files to reuse an id's slot or append.
  const ls = execShell(`ls -1 "${tlDir}" 2>/dev/null`);
  const existing = ls.ok ? ls.stdout.trim().split('\n').map((s) => s.trim()).filter((f) => /\.md$/.test(f)) : [];
  let ordinal: number;
  if (typeof spec.ordinal === 'number' && spec.ordinal > 0) {
    ordinal = spec.ordinal;
  } else {
    const match = existing.find((f) => f.replace(/^\d+[-_]/, '').replace(/\.md$/, '') === id);
    if (match) {
      ordinal = parseInt(match.match(/^(\d+)/)?.[1] ?? '0', 10) || existing.length;
    } else {
      const maxOrd = existing.reduce((m, f) => Math.max(m, parseInt(f.match(/^(\d+)/)?.[1] ?? '0', 10) || 0), 0);
      ordinal = maxOrd + 1;
    }
  }
  const num = String(ordinal).padStart(2, '0');

  const outputYaml = Object.entries(spec.output).map(([k, v]) => `  ${k}: ${v}`).join('\n');
  const deps = spec.dependsOn ?? [];
  const dependsOnYaml = deps.length > 0 ? `dependsOn: [${deps.join(', ')}]` : 'dependsOn: []';

  const lines = [
    '---',
    `id: ${id}`,
    'output:',
    outputYaml,
    dependsOnYaml,
    `optional: ${spec.optional ?? false}`,
    `goal: ${spec.goal ?? false}`,
    ...(spec.condition ? [`condition: "${String(spec.condition).replace(/"/g, '\\"')}"`] : []),
    '---',
    '',
    spec.instruction,
  ];

  const path = joinPath(tlDir, `${num}-${id}.md`);
  const w = writeFileRaw(path, lines.join('\n'));
  if (!w.ok) return { ok: false, path, error: `Failed to write ${path}: ${w.error}` };
  return { ok: true, path };
}
