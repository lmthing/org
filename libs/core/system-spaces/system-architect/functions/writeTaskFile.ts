interface TaskFileSpec {
  id: string;
  instruction: string;
  /** Map of output field name → type string, e.g. { answer: 'string', found: 'boolean' }. */
  output: Record<string, string>;
  dependsOn?: string[];
  goal?: boolean;
  optional?: boolean;
  condition?: string;
  /** Fork capability profile: 'explore'/'plan' are READ-ONLY (no writeFileRaw, no mutating
   *  shell); 'general' has the full toolkit. Default 'general'. Choose the least that works. */
  role?: 'explore' | 'plan' | 'general';
  /** Allowlist of space-function names this task's fork may call (least privilege). Omit for all. */
  functions?: string[];
  /** Host-driven fan-out: "<upstreamTaskId>.<field>" naming an upstream array. The task runs
   *  once per element (parallel), each fork receiving the element as `item`; results collect
   *  into an array. The referenced task MUST also be in dependsOn. */
  forEach?: string;
  /** Per-task delegation allowlist: "space/agent" or "space/agent#action". When set, the task
   *  may delegate() to exactly these targets (and nothing else). */
  canDelegateTo?: string[];
  /** Force a specific 1-based ordinal; otherwise reuse the existing one for this id or append. */
  ordinal?: number;
}

/**
 * The grounding rule every knowledge-grounded task carries (appended by `writeTaskFile` when the
 * instruction loads knowledge and does not already say it).
 *
 * A task told only to "answer the query, grounded in the knowledge" has no rule for the case that
 * matters most: the knowledge does NOT cover the question. A small fork model then answers from
 * the nearest note it did load. Live: a household-insurance space asked "what did your market
 * check conclude — is there a cheaper option?" loaded its `car-policy` note (which knows only the
 * current AXA policy), and told the user there **was** a cheaper option — "with AXA Hull", their
 * existing €642 insurer — while the saved research row said `verified_cheaper_quote_found: false`.
 * The knowledge was silent, so the model invented. Enforced at the writer (not just in the
 * architect's prompt template) so it survives the model paraphrasing that template.
 */
const GROUNDING_RULE =
  "Ground every claim in the knowledge you loaded: state ONLY what it supports. If the loaded " +
  "knowledge does not answer `query`, say so plainly in your answer and state what you DO know — " +
  'never infer, guess, or present a conclusion the knowledge does not state.';

/** Does this instruction already carry a grounding rule (in any phrasing)? */
function hasGroundingRule(instruction: string): boolean {
  return /does not (answer|cover)|doesn't (answer|cover)|never (infer|guess|fabricate|invent)/i.test(
    instruction,
  );
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
 * A task whose instruction calls `loadKnowledge(...)` gets `GROUNDING_RULE` appended unless it
 * already states one — so a generated agent says "my notes don't cover that" instead of inventing.
 *
 * @returns { ok, path, error? }
 */
export function writeTaskFile(
  space: string,
  tasklist: string,
  spec: TaskFileSpec,
): { ok: boolean; path: string; error?: string } {
  const dir = resolveSpaceDir(space);
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
  // Reject placeholder loadKnowledge calls (e.g. loadKnowledge('<domain>','<field>','<aspect>.md'))
  // — they point at nonexistent files and fail validation. Use the REAL slugs you wrote.
  if (/loadKnowledge\([^)]*<[A-Za-z]/.test(spec.instruction)) {
    return { ok: false, path: '', error: "writeTaskFile: instruction contains a placeholder loadKnowledge(...) call with <…> angle-brackets. Replace every <domain>/<field>/<aspect> with the REAL slugs (e.g. loadKnowledge('chania_guide','beaches','elafonissi.md'))." };
  }

  // A knowledge-grounded task must never answer past its knowledge (see GROUNDING_RULE).
  const instruction = /loadKnowledge\s*\(/.test(spec.instruction) && !hasGroundingRule(spec.instruction)
    ? `${spec.instruction.trim()}\n\n${GROUNDING_RULE}`
    : spec.instruction;

  const id = String(spec.id).replace(/^\d+[-_]?/, '').replace(/\.md$/i, '') || 'task';
  const tlDir = spacePath(dir, 'tasklists', tasklist);

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

  const role = spec.role === 'explore' || spec.role === 'plan' || spec.role === 'general' ? spec.role : undefined;
  const functions = Array.isArray(spec.functions) ? spec.functions.map((f) => String(f).replace(/\.(ts|md)$/i, '')) : [];

  const lines = [
    '---',
    `id: ${id}`,
    'output:',
    outputYaml,
    dependsOnYaml,
    `optional: ${spec.optional ?? false}`,
    `goal: ${spec.goal ?? false}`,
    ...(role ? [`role: ${role}`] : []),
    ...(functions.length > 0 ? ['functions:', ...functions.map((f) => `  - ${f}`)] : []),
    ...(spec.forEach ? [`forEach: ${String(spec.forEach).trim()}`] : []),
    ...(Array.isArray(spec.canDelegateTo) && spec.canDelegateTo.length > 0
      ? ['canDelegateTo:', ...spec.canDelegateTo.map((t) => `  - ${String(t).trim()}`)]
      : []),
    ...(spec.condition ? [`condition: "${String(spec.condition).replace(/"/g, '\\"')}"`] : []),
    '---',
    '',
    instruction,
  ];

  const path = spacePath(tlDir, `${num}-${id}.md`);
  const w = writeFileRaw(path, lines.join('\n'));
  if (!w.ok) return { ok: false, path, error: `Failed to write ${path}: ${w.error}` };
  return { ok: true, path };
}
