import type { Space, AgentDef } from '../spaces/load.js';
import type { ResolvedDep } from '../spaces/agent.js';
import { getAgentFunctions } from '../spaces/agent.js';
import { getAgentComponents } from '../spaces/components.js';
import { resolveKnowledge } from '../spaces/knowledge.js';
import ts from 'typescript';
import { extractFunctionSignature, extractPropsDeclaration, extractComponentDoc } from '../typecheck/overlay.js';
import { catalogSummary } from '../ui/catalog.js';

/**
 * Render the prop list for a component's `<Name .../>` example tag using the
 * AST-based Props extraction (replaces the old `interface Props` regex scan).
 * Falls back to no props shown when the component declares no `Props` interface.
 */
function renderComponentPropsExample(componentName: string, src: string): string {
  const decl = extractPropsDeclaration(componentName, src);
  if (!decl) return '';
  const body = decl.match(/\{([^]*)\}/)?.[1] ?? '';
  const propNames = [...body.matchAll(/(\w+)\??\s*:/g)].map((m) => m[1]!);
  return propNames.map((p) => `${p}={...}`).join(' ');
}

/**
 * Resolve a 3-part knowledge ref (`domain/field/option`) to its preloaded body
 * for direct system-block injection. Returns undefined for 2-part refs
 * (`domain/field`) — those stay on-demand via `loadKnowledge()`.
 */
export interface KnowledgePreload {
  domainSlug: string;
  fieldSlug: string;
  optionSlug: string;
  /** Resolved value from `resolveKnowledge` — either the raw body string or a
   *  frontmatter object with a `body` field. */
  value: unknown;
}

export interface SystemBlockOpts {
  space: Space;
  agent: AgentDef;
  directDeps: ResolvedDep[];
  /** System-space functions (fs/web/memory/todo). Rendered concisely as built-in
   *  tools — signature + one-line doc only, not full source — to keep the prompt lean. */
  systemFunctions?: Record<string, string>;
  /** Pre-resolved option-level knowledge preloads (3-part `domain/field/option`
   *  refs in `agent.config.knowledge`). `resolveKnowledge` is async, so callers
   *  resolve these up front (see `resolvePreloadedKnowledge`) and pass the
   *  results in here — keeps `buildSystemBlock` itself synchronous. */
  knowledgePreloads?: KnowledgePreload[];
  /** Omit `ask` from the prompt — set for delegated/headless agents that have no
   *  interactive user (the global is not injected there either). Default false. */
  omitAsk?: boolean;
}

/**
 * Pre-resolve every 3-part (option-level) knowledge ref in an agent's
 * `config.knowledge` list. Called by session/delegate/fork boot code before
 * `buildSystemBlock` — `resolveKnowledge` hits the filesystem, so this is async.
 */
export async function resolvePreloadedKnowledge(space: Space, agent: AgentDef): Promise<KnowledgePreload[]> {
  const preloads: KnowledgePreload[] = [];
  for (const ref of agent.config.knowledge) {
    const parts = ref.split('/');
    if (parts.length !== 3) continue;
    const [domainSlug, fieldSlug, optionSlug] = parts as [string, string, string];
    try {
      const value = await resolveKnowledge(space, [domainSlug, fieldSlug, optionSlug]);
      preloads.push({ domainSlug, fieldSlug, optionSlug, value });
    } catch {
      // Ref validated at load time; a resolution failure here is unexpected —
      // skip rather than abort system-block construction.
    }
  }
  return preloads;
}

/** Render a tool as its full signature (incl. return type) + full JSDoc. */
function extractToolSummary(name: string, src: string): string {
  // Reuse the overlay's AST-based extractor for an accurate signature including
  // the full (possibly object) return type — critical so the model knows to
  // destructure results like `readFile(...).content` instead of using them raw.
  const decl = extractFunctionSignature(name, src)
    .replace(/^declare\s+(async\s+)?function\s+/, '')
    .replace(/;$/, '');

  // Extract full JSDoc text using AST (not regex) so multi-line docs are preserved.
  const sf = ts.createSourceFile('fn.ts', src, ts.ScriptTarget.ESNext, true);
  let doc = '';
  for (const node of sf.statements) {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === name &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      // ts.getJSDocCommentsAndTags returns (JSDoc | JSDocTag)[]
      const jsDocs = ts.getJSDocCommentsAndTags(node);
      const commentParts: string[] = [];
      for (const j of jsDocs) {
        if (ts.isJSDoc(j)) {
          commentParts.push((j.comment ?? '').toString().trim());
        }
      }
      doc = commentParts.join(' ');
      break;
    }
  }

  // Fallback: line comment
  if (!doc) {
    doc = src.match(/^\s*\/\/\s*(.+)$/m)?.[1]?.trim() ?? '';
  }

  return `- \`${decl}\`${doc ? ` — ${doc}` : ''}`;
}

const RUNTIME_PREAMBLE = `
CRITICAL INSTRUCTION: You are a TypeScript code execution agent. Your entire response is fed directly into a TypeScript evaluator, so it MUST be valid TypeScript. Do NOT emit bare prose or natural language — a single word of non-code, non-comment text is a typecheck error that wastes a turn.

If you want to think out loud, explain your reasoning, or narrate a plan, write it INSIDE a \`// comment\`. Comments are valid TypeScript and are encouraged for narration — bare sentences are not. Example:
  // First load the knowledge, then diagnose from the user's query.
  const k = await loadKnowledge("espresso", "fundamentals", "overview.md");

Respond with valid TypeScript statements only. Use top-level \`await\` for async operations (e.g. \`const x = await tasklist(...)\`). Do not wrap code in functions or markdown code blocks. Just write the statements directly.

ABSOLUTELY FORBIDDEN — these will cause parse errors or runtime errors:
  - \`\`\`typescript or \`\`\`ts or \`\`\` (markdown code fences)
  - Bare English text or explanations OUTSIDE of a \`//\` comment
  - function wrappers, IIFE patterns, or async IIFEs like \`await (async () => { ... })()\`
  - setTimeout, setInterval, clearTimeout, clearInterval (not available — use sleep() instead)

Use sequential top-level await statements, not IIFEs:
WRONG: const x = await (async () => { const t = await tasklist("x"); return t; })()
CORRECT: const x = await tasklist("x");

WRONG (do not do this):
  \`\`\`typescript
  const result = await tasklist("make_pasta");
  \`\`\`

CORRECT (do this):
  const result = await tasklist("make_pasta");

CONTEXT ECONOMY:
  - display() shows output to the user but does NOT grow the variables block — use it for intermediate results instead of binding large values you won't reuse.
  - Push heavy investigation into fork({ role: 'explore', ... }) — a subagent reads/searches in its own context and returns only a concise summary, keeping your context small.
  - Preview large data with inspect([value, { keys: true }]) or { depth: 1 } before pulling all of it into scope.

GROUND TRUTH — never re-type a value you only saw in the VARIABLES block:
  - The VARIABLES block is a LOSSY PREVIEW. Long strings/arrays/objects are TRUNCATED there (you'll see markers like \`… (802 chars total)\` or \`[… 12 items, truncated]\`). You are seeing the opening only — NOT the full value.
  - The VM holds the REAL, full value under the variable name. So ALWAYS pass data forward by REFERENCING the bound variable (e.g. \`report.executive_summary\`, \`results[0].url\`) — the runtime substitutes the real value at eval time.
  - NEVER copy a truncated value into a new string/array literal (\`const summary = "…"\`). Re-typing what you saw means inventing the truncated tail — that is hallucination, and it silently corrupts data that arrived correct.
  - When you genuinely need to READ the full content of a truncated field (e.g. to split it across files, or to quote it), pull it back into scope FIRST with inspect — and BIND the result: \`const full = await inspect([report, { path: 'executive_summary' }]);\` or \`const head = await inspect([items, { slice: [0, 10] }]);\`. Only after inspecting should you use the value.
`.trim();

function globalsSummary(omitAsk: boolean): string {
  const askBullet = omitAsk
    ? ''
    : '- `ask(descriptor)` — render an interactive form and await user input (yields). Compose built-in UI components — see # UI Components.\n';
  const yieldList = omitAsk
    ? 'inspect, loadKnowledge, sleep, tasklist, fork, delegate'
    : 'ask, inspect, loadKnowledge, sleep, tasklist, fork, delegate';
  const autonomyNote = omitAsk
    ? '\nThis agent runs AUTONOMOUSLY: work entirely from the request/seed you were given. If a detail is missing, assume a sensible default and state it — never wait for input.\n'
    : '';
  const castExamples = omitAsk
    ? '  const result = await tasklist("my_list");   // result.field is usable directly\n  const data = await delegate(...);            // data.key is usable directly'
    : '  const topic = await ask("...") as string;\n  const result = await tasklist("my_list");   // result.field is usable directly\n  const data = await delegate(...);            // data.key is usable directly';
  return `
# Available Globals

${askBullet}- \`display(descriptor)\` — render content to the surface (void, no yield). Accepts a string or JSX: \`display("text")\` or \`display(<Stack>…</Stack>)\`. Compose built-in UI components — see # UI Components.
- \`inspect(...values)\` — inspect variables with optional queries (yields)
- \`loadKnowledge(...path)\` — load a knowledge file by path segments (yields)
- \`sleep(duration)\` — pause execution for a duration like "1s", "500ms" (yields)
- \`tasklist(name, seed?)\` — run a named tasklist and return its goal output (yields). Pass seed to share variables with tasks: \`tasklist("my_list", { topic })\`
- \`fork(opts)\` — spawn an isolated subagent and await its typed result (yields). The subagent runs in its own context and returns ONLY what it resolves — use it as a context firewall for heavy investigation. Set \`role\`: \`'explore'\` (read-only research), \`'plan'\` (read-only design), or \`'general'\` (full toolkit, default). Launch several at once with \`Promise.all([fork({role:'explore',...}), fork({role:'explore',...})])\`.
- \`delegate(packageName, agentName, action?, opts?)\` — delegate to another agent (yields). With an \`action\` id it runs that action; omit \`action\` to let the agent run model-driven and pick one of its own actions/tasklists.

Value-yielding globals (${yieldList}) end the current turn.
display() is void and does not end the turn.
${autonomyNote}
tasklist(), delegate() and loadKnowledge() return loosely-typed values — read their fields directly:
${castExamples}

fork() spawns an isolated subagent. REQUIRED fields: \`instruction\` (what to do) and
\`output\` (a schema mapping each result field to its type). Optional \`role\`. The
subagent returns ONLY what it resolves — investigation it does stays out of your context.
  const res = await fork({
    role: 'explore',
    instruction: "Find every .ts file under fixtures/cooking and summarize what each function does.",
    output: { files: 'string[]', summary: 'string' },
  }) as { files: string[]; summary: string };
  display(res.summary);
Run several subagents at once:
  const [a, b] = await Promise.all([
    fork({ role: 'explore', instruction: "...", output: { found: 'string' } }),
    fork({ role: 'explore', instruction: "...", output: { found: 'string' } }),
  ]);
`.trim();
}

/**
 * Build the system prompt for an agent.
 */
export function buildSystemBlock(opts: SystemBlockOpts): string {
  const { space, agent, directDeps } = opts;

  const sections: string[] = [];

  // 0. Runtime preamble — always first
  sections.push(RUNTIME_PREAMBLE);

  // 1. Globals summary
  sections.push(globalsSummary(opts.omitAsk === true));

  // 1a. UI component catalog — tell the model what display/form components exist
  sections.push(catalogSummary());

  // 1b. Built-in tools from system spaces (concise — signatures + one-line docs)
  if (opts.systemFunctions && Object.keys(opts.systemFunctions).length > 0) {
    const toolLines = Object.entries(opts.systemFunctions).map(([name, src]) =>
      extractToolSummary(name, src),
    );
    sections.push(
      `# Built-in Tools\n\nAlways available (call directly, already in scope):\n\n${toolLines.join('\n')}`,
    );
  }

  // 2. Agent instructions
  if (agent.instructBody) {
    sections.push(`# Agent Instructions\n\n${agent.instructBody}`);
  }

  // 3. Agent actions
  if (agent.actions.length > 0) {
    const actionLines = agent.actions.map(
      (a) => `- \`${a.id}\` — **${a.label}**: ${a.description} (tasklist: ${a.tasklist})`,
    );
    sections.push(`# Actions\n\n${actionLines.join('\n')}`);
  }

  // 4. Scoped functions — signature + one-line doc only, NOT full source. The
  // full implementation is injected into the VM as a callable global; the model
  // only needs the exported signature (and JSDoc) to call it correctly. Dumping
  // entire function bodies into every prompt is pure token waste.
  // Dedupe against the Built-in Tools list above: when the running space IS a
  // system space (e.g. the architect), its functions are also in systemFunctions,
  // and would otherwise be listed twice.
  const systemFnNames = new Set(Object.keys(opts.systemFunctions ?? {}));
  const agentFunctions = getAgentFunctions(space, agent);
  const scopedFunctions = Object.entries(agentFunctions).filter(([name]) => !systemFnNames.has(name));
  if (scopedFunctions.length > 0) {
    const fnParts = scopedFunctions.map(([name, src]) => extractToolSummary(name, src));
    sections.push(`# Available Functions\n\nCall directly (already in scope):\n\n${fnParts.join('\n')}`);
  }

  // 4b. Knowledge — refs are "domain/field" (on-demand: list the field + its
  // options, agent loads via loadKnowledge()) or "domain/field/option" (PRELOAD:
  // inject the option's body directly, and do NOT list its sibling options —
  // the agent only has access to the one it was bound to).
  if (agent.config.knowledge.length > 0) {
    const preloadByKey = new Map((opts.knowledgePreloads ?? []).map((p) => [`${p.domainSlug}/${p.fieldSlug}`, p]));
    const onDemandLines: string[] = [];
    const preloadParts: string[] = [];
    const describedDomains = new Set<string>();
    const domainDescLines: string[] = [];

    for (const ref of agent.config.knowledge) {
      const parts = ref.split('/');
      const domainSlug = parts[0];
      const fieldSlug = parts[1];
      if (!domainSlug || !fieldSlug) continue;
      const domain = space.knowledge.domains[domainSlug];
      if (!domain) continue;
      const field = domain.fields[fieldSlug];
      if (!field) continue;

      // Prepend each referenced domain's description once.
      if (domain.description && !describedDomains.has(domainSlug)) {
        describedDomains.add(domainSlug);
        domainDescLines.push(`**${domainSlug}**: ${domain.description}`);
      }

      const preload = parts.length === 3 ? preloadByKey.get(`${domainSlug}/${fieldSlug}`) : undefined;
      if (preload) {
        const body =
          typeof preload.value === 'object' && preload.value !== null && 'body' in preload.value
            ? String((preload.value as { body?: unknown }).body ?? '')
            : String(preload.value);
        preloadParts.push(
          `- **${domainSlug}/${fieldSlug}** is preloaded with option \`${preload.optionSlug}\` — you do NOT have access to its other options:\n\n${body}`,
        );
      } else {
        const options = Object.keys(field.options).join(', ');
        // The field's index.md body is its OVERVIEW — surface it inline so the agent
        // always has the summary, then list the option files (specific aspects) to
        // load on demand for detail.
        const overview = field.description ? `\n    overview: ${field.description.replace(/\s+/g, ' ').trim()}` : '';
        onDemandLines.push(`  - \`${domainSlug}/${fieldSlug}\` (${field.type})${overview}\n    aspects (load on demand): ${options || '(none)'}`);
      }
    }

    const knowledgeParts: string[] = [];
    if (domainDescLines.length > 0) knowledgeParts.push(domainDescLines.join('\n'));
    if (preloadParts.length > 0) knowledgeParts.push(preloadParts.join('\n\n'));
    if (onDemandLines.length > 0) {
      knowledgeParts.push(`Access with \`loadKnowledge(domain, field, option)\`:\n\n${onDemandLines.join('\n')}`);
    }
    if (knowledgeParts.length > 0) {
      sections.push(`# Knowledge\n\n${knowledgeParts.join('\n\n')}`);
    }
  }

  // 4c. Components — AST-based props + JSDoc (replaces the old regex prop scan).
  // View and form components are both authored as a single source file.
  const agentComponents = getAgentComponents(space, agent);
  const viewNames = Object.keys(agentComponents.view);
  const formNames = Object.keys(agentComponents.form);
  if (viewNames.length > 0 || formNames.length > 0) {
    const compParts: string[] = [];
    for (const [name, src] of Object.entries(agentComponents.view)) {
      const props = renderComponentPropsExample(name, src);
      const doc = extractComponentDoc(name, src);
      compParts.push(`- **${name}** (view)${doc ? ` — ${doc}` : ''}: \`<${name}${props ? ` ${props}` : ''} />\``);
    }
    // Form components are only usable via ask(); omit them entirely for autonomous
    // (delegated/headless) agents that have no ask().
    if (!opts.omitAsk) {
      for (const [name, src] of Object.entries(agentComponents.form)) {
        const props = renderComponentPropsExample(name, src);
        const doc = extractComponentDoc(name, src);
        compParts.push(`- **${name}** (form — use with ask())${doc ? ` — ${doc}` : ''}: \`await ask(<${name}${props ? ` ${props}` : ''} />)\``);
      }
    }
    sections.push(`# Components\n\n${compParts.join('\n')}`);
  }

  // 5. Direct dependency agents — metadata + description + ONLY the allowed
  // actions (allowedActions undefined ⇒ all actions are allowed).
  if (directDeps.length > 0) {
    const depParts = directDeps.map(({ agent: depAgent, target, allowedActions }) => {
      const slash = target.lastIndexOf('/');
      const pkgName = slash >= 0 ? target.slice(0, slash) : target;
      const agentName = slash >= 0 ? target.slice(slash + 1) : target;
      const visibleActions = allowedActions
        ? depAgent.actions.filter((a) => allowedActions.includes(a.id))
        : depAgent.actions;
      const actionLines = visibleActions.map((a) => `  - \`${a.id}\`: ${a.description}`).join('\n');
      const restrictionNote = allowedActions
        ? `\n  (restricted to: ${allowedActions.join(', ')})`
        : '';
      const callExample = visibleActions[0]
        ? `delegate("${pkgName}", "${agentName}", "${visibleActions[0].id}", { query, context })`
        : `delegate("${pkgName}", "${agentName}", actionId)`;
      const refForm = slash >= 0 ? target : agentName;
      return `## \`${refForm}\` — ${depAgent.title}${restrictionNote}\n${depAgent.instructBody ? `${depAgent.instructBody}\n\n` : ''}${actionLines}\n\n  Example: \`${callExample}\``;
    });
    sections.push(`# Delegatable Agents\n\n${depParts.join('\n\n')}`);
  }

  return sections.join('\n\n');
}
