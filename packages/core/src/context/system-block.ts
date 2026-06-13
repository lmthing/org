import type { Space, AgentDef } from '../spaces/load.js';
import type { ResolvedDep } from '../spaces/agent.js';
import { getAgentFunctions } from '../spaces/agent.js';
import { getAgentComponents } from '../spaces/components.js';
import ts from 'typescript';
import { extractFunctionSignature } from '../typecheck/overlay.js';
import { catalogSummary } from '../ui/catalog.js';

/** Extract optional prop names from a component's Props interface for display in system prompt */
function extractComponentProps(src: string): string {
  const propsMatch = src.match(/interface\s+Props\s*\{([^}]+)\}/);
  if (!propsMatch) return '';
  const body = propsMatch[1]!;
  const propNames = [...body.matchAll(/(\w+)\??\s*:/g)].map((m) => m[1]!);
  return propNames.map((p) => `${p}={...}`).join(' ');
}

export interface SystemBlockOpts {
  space: Space;
  agent: AgentDef;
  directDeps: ResolvedDep[];
  /** System-space functions (fs/web/memory/todo). Rendered concisely as built-in
   *  tools — signature + one-line doc only, not full source — to keep the prompt lean. */
  systemFunctions?: Record<string, string>;
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
CRITICAL INSTRUCTION: You are a TypeScript code execution agent. You MUST respond with TypeScript code ONLY. Do NOT write any prose, explanations, markdown, or natural language. Your entire response will be fed directly into a TypeScript evaluator. Even a single word of prose will cause an error.

Respond with valid TypeScript statements only. Use top-level \`await\` for async operations (e.g. \`const x = await ask(...)\`). Do not wrap code in functions or markdown code blocks. Just write the statements directly.

ABSOLUTELY FORBIDDEN — these will cause parse errors or runtime errors:
  - \`\`\`typescript or \`\`\`ts or \`\`\` (markdown code fences)
  - Any English text, explanations, or comments
  - function wrappers, IIFE patterns, or async IIFEs like \`await (async () => { ... })()\`
  - setTimeout, setInterval, clearTimeout, clearInterval (not available — use sleep() instead)

Use sequential top-level await statements, not IIFEs:
WRONG: const x = await (async () => { const t = await ask(...); return t; })()
CORRECT: const x = await ask(...);

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

const GLOBALS_SUMMARY = `
# Available Globals

- \`ask(descriptor)\` — render an interactive form and await user input (yields). Compose built-in UI components — see # UI Components.
- \`display(descriptor)\` — render content to the surface (void, no yield). Accepts a string or JSX: \`display("text")\` or \`display(<Stack>…</Stack>)\`. Compose built-in UI components — see # UI Components.
- \`inspect(...values)\` — inspect variables with optional queries (yields)
- \`loadKnowledge(...path)\` — load a knowledge file by path segments (yields)
- \`sleep(duration)\` — pause execution for a duration like "1s", "500ms" (yields)
- \`tasklist(name, seed?)\` — run a named tasklist and return its goal output (yields). Pass seed to share variables with tasks: \`tasklist("my_list", { topic })\`
- \`fork(opts)\` — spawn an isolated subagent and await its typed result (yields). The subagent runs in its own context and returns ONLY what it resolves — use it as a context firewall for heavy investigation. Set \`role\`: \`'explore'\` (read-only research), \`'plan'\` (read-only design), or \`'general'\` (full toolkit, default). Launch several at once with \`Promise.all([fork({role:'explore',...}), fork({role:'explore',...})])\`.
- \`delegate(packageName, agentName, action, opts?)\` — delegate to another agent's action (yields)
- \`solve(opts)\` — verifier-gated escalation (yields). Runs an attempt, and ONLY while a check keeps failing escalates: single → retry-with-feedback → race-N, bounded by budget. Give \`verifyCommand\` (a shell check — tests/type-check; exit 0 = pass) or \`verifyCondition\` (a condition over the output). With no verify it runs exactly once. Returns \`{ value, rung, attempts, verified }\`. Use it ONLY when you have a real check; otherwise call \`fork\` directly.

Value-yielding globals (ask, inspect, loadKnowledge, sleep, tasklist, fork, delegate, solve) end the current turn.
display() is void and does not end the turn.

IMPORTANT: ask(), tasklist(), and delegate() all return unknown. Cast results to use them:
  const topic = await ask("...") as string;
  const result = await tasklist("my_list") as { field: string };
  const data = await delegate(...) as { key: string };

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

/**
 * Build the system prompt for an agent.
 */
export function buildSystemBlock(opts: SystemBlockOpts): string {
  const { space, agent, directDeps } = opts;

  const sections: string[] = [];

  // 0. Runtime preamble — always first
  sections.push(RUNTIME_PREAMBLE);

  // 1. Globals summary
  sections.push(GLOBALS_SUMMARY);

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

  // 4. Scoped functions
  const agentFunctions = getAgentFunctions(space, agent);
  if (Object.keys(agentFunctions).length > 0) {
    const fnParts = Object.entries(agentFunctions).map(
      ([name, src]) => `## ${name}\n\`\`\`ts\n${src}\n\`\`\``,
    );
    sections.push(`# Available Functions\n\n${fnParts.join('\n\n')}`);
  }

  // 4b. Knowledge tree
  const knowledgeDomains = Object.keys(space.knowledge.domains);
  if (knowledgeDomains.length > 0 && agent.config.knowledge.length > 0) {
    const relevantDomains = agent.config.knowledge.filter((k) => knowledgeDomains.includes(k));
    if (relevantDomains.length > 0) {
      const domainLines = relevantDomains.map((slug) => {
        const domain = space.knowledge.domains[slug]!;
        const fields = Object.entries(domain.fields).map(([fSlug, f]) => {
          const options = Object.keys(f.options).join(', ');
          return `  - \`${fSlug}\` (${f.type}): ${options ? `options: ${options}` : 'no options'}`;
        });
        return `- **${slug}**:\n${fields.join('\n')}`;
      });
      sections.push(`# Knowledge\n\nAccess with \`loadKnowledge(domain, field, option)\`:\n\n${domainLines.join('\n')}`);
    }
  }

  // 4c. Components
  const agentComponents = getAgentComponents(space, agent);
  const viewNames = Object.keys(agentComponents.view);
  const formNames = Object.keys(agentComponents.form);
  if (viewNames.length > 0 || formNames.length > 0) {
    const compParts: string[] = [];
    for (const [name, src] of Object.entries(agentComponents.view)) {
      const props = extractComponentProps(src);
      compParts.push(`- **${name}** (view): \`<${name}${props ? ` ${props}` : ''} />\``);
    }
    for (const [name, { web }] of Object.entries(agentComponents.form)) {
      const props = extractComponentProps(web);
      compParts.push(`- **${name}** (form — use with ask()): \`await ask(<${name}${props ? ` ${props}` : ''} />)\``);
    }
    sections.push(`# Components\n\n${compParts.join('\n')}`);
  }

  // 5. Direct dependency agents
  if (directDeps.length > 0) {
    const depParts = directDeps.map(({ agent: depAgent, target }) => {
      const slash = target.lastIndexOf('/');
      const pkgName = target.slice(0, slash);
      const agentName = target.slice(slash + 1);
      const actionLines = depAgent.actions
        .map((a) => `  - \`${a.id}\`: ${a.description}`)
        .join('\n');
      const callExample = depAgent.actions[0]
        ? `delegate("${pkgName}", "${agentName}", "${depAgent.actions[0].id}", { query, context })`
        : `delegate("${pkgName}", "${agentName}", actionId)`;
      return `## ${target} — ${depAgent.title}\n${actionLines}\n\n  Example: \`${callExample}\``;
    });
    sections.push(`# Delegatable Agents\n\n${depParts.join('\n\n')}`);
  }

  return sections.join('\n\n');
}
