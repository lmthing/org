/** Join path segments with '/'. Replaces node:path.join inside the QuickJS VM. */
function joinPath(...parts: string[]): string {
  return parts
    .map((p, i) => (i === 0 ? p.replace(/\/+$/, '') : p.replace(/^\/+|\/+$/g, '')))
    .filter(Boolean)
    .join('/');
}

interface AgentActionSpec {
  id: string;
  label: string;
  description: string;
  tasklist: string;
}

interface AgentFileSpec {
  agentSlug: string;
  agentTitle: string;
  systemPrompt: string;
  /** Bare function names (no .ts) the agent declares — written separately via writeFunctionFile. */
  functions?: string[];
  /** Knowledge refs "<domain>/<field>" (field-level) or "<domain>/<field>/<option>" (preload). */
  knowledge?: string[];
  /** Component names — written separately via writeComponentFile. */
  components?: string[];
  actions?: AgentActionSpec[];
  /** Action id to run deterministically in a freeform session. Defaults to the sole action. */
  defaultAction?: string;
  /** Delegation targets (e.g. "space/agent" or "agent#action"). Replaces the legacy `dependencies`. */
  canDelegateTo?: string[];
}

/** Strip a trailing file extension models often bake into a name (.md/.ts/.tsx/.js/.jsx). */
function stripExt(name: string): string {
  return String(name).replace(/\.(md|tsx?|jsx?)$/i, '');
}

/**
 * Write a single agent's `agents/<slug>/instruct.md` — the ONE file that declares
 * the agent's frontmatter (title, knowledge/function/component refs, actions,
 * defaultAction, dependencies) plus its system-prompt body. Overwrites in place so
 * iteration is idempotent. The model lists what it WILL add here; the referenced
 * function/knowledge/task/component files are written by the sibling builders.
 *
 * Uses only writeFileRaw (which mkdir -p's the parent dir). No imports.
 *
 * @returns { ok, path, error? }
 */
export function writeAgentFile(
  dir: string,
  spec: AgentFileSpec,
): { ok: boolean; path: string; error?: string } {
  if (!spec || typeof spec !== 'object') {
    return { ok: false, path: '', error: 'writeAgentFile: spec must be an object' };
  }
  const slug = stripExt(spec.agentSlug ?? '');
  if (!slug) return { ok: false, path: '', error: 'writeAgentFile: spec.agentSlug is required' };
  if (!spec.agentTitle) return { ok: false, path: '', error: 'writeAgentFile: spec.agentTitle is required' };
  if (!spec.systemPrompt) return { ok: false, path: '', error: 'writeAgentFile: spec.systemPrompt is required' };

  const listBlock = (key: string, items: string[]): string =>
    items.length > 0 ? `${key}:\n` + items.map((n) => `  - ${n}`).join('\n') : `${key}: []`;

  const functionNames = (spec.functions ?? []).map(stripExt);
  const knowledgeRefs = spec.knowledge ?? [];
  const componentNames = (spec.components ?? []).map(stripExt);
  const delegateTargets = spec.canDelegateTo ?? [];
  const actions = spec.actions ?? [];

  const actionBlock = actions.length > 0
    ? 'actions:\n' + actions.map((a) => [
        `  - id: ${a.id}`,
        `    label: "${String(a.label ?? a.id).replace(/"/g, '\\"')}"`,
        `    description: "${String(a.description ?? '').replace(/"/g, '\\"')}"`,
        `    tasklist: ${a.tasklist}`,
      ].join('\n')).join('\n')
    : 'actions: []';

  // defaultAction: explicit if it names a real action, else the sole action.
  const explicit = typeof spec.defaultAction === 'string' && actions.some((a) => a.id === spec.defaultAction)
    ? spec.defaultAction
    : undefined;
  const sole = actions.length === 1 ? actions[0]!.id : undefined;
  const defaultActionId = explicit ?? sole;

  const frontmatter = [
    '---',
    `title: ${spec.agentTitle}`,
    listBlock('knowledge', knowledgeRefs),
    listBlock('functions', functionNames),
    listBlock('components', componentNames),
    actionBlock,
    ...(defaultActionId ? [`defaultAction: ${defaultActionId}`] : []),
    listBlock('canDelegateTo', delegateTargets),
    '---',
    '',
    spec.systemPrompt,
  ].join('\n');

  const path = joinPath(dir, 'agents', slug, 'instruct.md');
  const w = writeFileRaw(path, frontmatter);
  if (!w.ok) return { ok: false, path, error: `Failed to write ${path}: ${w.error}` };
  return { ok: true, path };
}
