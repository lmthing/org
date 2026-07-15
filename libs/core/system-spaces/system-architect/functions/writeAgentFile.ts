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
  /** Short fork-safe charter (identity + domain + standing guardrails) — written to
   *  charter.md and injected into the agent's top-level prompt AND every task fork.
   *  Keep it 2-4 sentences; NO ask/delegate/UI/routing instructions (a fork can't honor those). */
  charter?: string;
  /** Bare function names (no .ts) the agent declares — written separately via writeFunctionFile. */
  functions?: string[];
  /** Knowledge refs "<domain>/<field>" (field-level) or "<domain>/<field>/<option>" (preload). */
  knowledge?: string[];
  /** Component names — written separately via writeComponentFile. */
  components?: string[];
  /** Bare app-capability ids the agent is granted (e.g. 'knowledge:write', 'db:read'). A
   *  synthesized space agent gets 'knowledge:write' so its research_and_store tasklist can
   *  persist findings into its own knowledge; 'db:read' is added only when the space needs to
   *  read the user's project data (the hybrid opt-in). */
  capabilities?: string[];
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
  space: string,
  spec: AgentFileSpec,
): { ok: boolean; path: string; error?: string } {
  const dir = resolveSpaceDir(space);
  if (!spec || typeof spec !== 'object') {
    return { ok: false, path: '', error: 'writeAgentFile: spec must be an object' };
  }
  const slug = stripExt(spec.agentSlug ?? '');
  if (!slug) return { ok: false, path: '', error: 'writeAgentFile: spec.agentSlug is required' };
  if (!spec.agentTitle) return { ok: false, path: '', error: 'writeAgentFile: spec.agentTitle is required' };
  if (!spec.systemPrompt) return { ok: false, path: '', error: 'writeAgentFile: spec.systemPrompt is required' };

  // Reject placeholder loadKnowledge calls immediately (fast, localized feedback). A
  // small model sometimes copies a template like loadKnowledge('<domain>','<field>','<aspect>.md')
  // verbatim into the prompt — that points at a nonexistent file and fails validation.
  if (/loadKnowledge\([^)]*<[A-Za-z]/.test(spec.systemPrompt)) {
    return { ok: false, path: '', error: "writeAgentFile: systemPrompt contains a placeholder loadKnowledge(...) call with <…> angle-brackets. Replace every <domain>/<field>/<aspect> with the REAL slugs you wrote (e.g. loadKnowledge('chania_guide','beaches','elafonissi.md')), or remove the call." };
  }

  const listBlock = (key: string, items: string[]): string =>
    items.length > 0 ? `${key}:\n` + items.map((n) => `  - ${n}`).join('\n') : `${key}: []`;

  const functionNames = (spec.functions ?? []).map(stripExt);
  // Safety net (host enforces): drop any declared knowledge ref whose index.md was not
  // actually written — a weak model sometimes over-declares a field it planned but the
  // build step never created. Keeping it would fail validateSpace and abort the whole
  // build; dropping it lets the agent ship with the knowledge that DOES exist.
  const knowledgeRefs = (spec.knowledge ?? []).filter((ref) => {
    const parts = String(ref).split('/');
    if (parts.length !== 2) return false; // must be "<domain>/<field>"
    const idx = readFileRaw(spacePath(dir, 'knowledge', parts[0]!, parts[1]!, 'index.md'), { limit: 1 });
    return idx.ok;
  });
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

  // Only recognized bare capability ids (drop config-bearing/unknown to keep synthesized
  // frontmatter valid — the runtime gate is parseCapabilities, this is a friendly pre-filter).
  const KNOWN_BARE_CAPS = ['knowledge:write', 'db:read', 'db:write', 'store:read'];
  const capabilityIds = (spec.capabilities ?? []).map(String).filter((c) => KNOWN_BARE_CAPS.includes(c));

  const frontmatter = [
    '---',
    `title: ${spec.agentTitle}`,
    listBlock('knowledge', knowledgeRefs),
    listBlock('functions', functionNames),
    listBlock('components', componentNames),
    ...(capabilityIds.length > 0 ? [listBlock('capabilities', capabilityIds)] : []),
    actionBlock,
    ...(defaultActionId ? [`defaultAction: ${defaultActionId}`] : []),
    listBlock('canDelegateTo', delegateTargets),
    '---',
    '',
    spec.systemPrompt,
  ].join('\n');

  const path = spacePath(dir, 'agents', slug, 'instruct.md');
  const w = writeFileRaw(path, frontmatter);
  if (!w.ok) return { ok: false, path, error: `Failed to write ${path}: ${w.error}` };

  // charter.md — fork-safe identity/guardrails (no frontmatter). Injected into every task
  // fork as well as the top-level prompt. Required by validateSpace, so always write one:
  // fall back to a minimal charter derived from the title when none is supplied.
  const charterBody = (spec.charter && spec.charter.trim())
    ? spec.charter.trim()
    : `You are ${spec.agentTitle}. Answer the user's request in your domain accurately and concisely, grounded only in what you actually know or load — never fabricate.`;
  const charterPath = spacePath(dir, 'agents', slug, 'charter.md');
  const cw = writeFileRaw(charterPath, charterBody + '\n');
  if (!cw.ok) return { ok: false, path: charterPath, error: `Failed to write ${charterPath}: ${cw.error}` };

  return { ok: true, path };
}
