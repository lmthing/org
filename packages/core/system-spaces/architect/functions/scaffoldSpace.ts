/** Join path segments with '/'. Replaces node:path.join inside the QuickJS VM. */
function joinPath(...parts: string[]): string {
  return parts
    .map((p, i) => (i === 0 ? p.replace(/\/+$/, '') : p.replace(/^\/+|\/+$/g, '')))
    .filter(Boolean)
    .join('/');
}

interface TaskSpec {
  id: string;
  instruction: string;
  output: Record<string, string>;
  dependsOn?: string[];
  goal?: boolean;
  optional?: boolean;
  condition?: string;
}

interface TasklistSpec {
  name: string;
  tasks: TaskSpec[];
}

interface FunctionSpec {
  name: string;
  source: string;
}

interface ActionSpec {
  id: string;
  label: string;
  description: string;
  tasklist: string;
}

/** One option file inside a knowledge field. `slug` is the filename without `.md`. */
interface KnowledgeOptionSpec {
  slug: string;
  content: string;
}

/**
 * One knowledge field: knowledge/<domain>/<field>/index.md (manifest) plus one
 * <option>.md per option. The synthesized agent loads it at runtime with
 * loadKnowledge('<domain>', '<field>', '<option>.md').
 */
interface KnowledgeSpec {
  domain: string;
  field: string;
  type?: string; // defaults to "string"
  variable: string;
  default?: string;
  description: string;
  options: KnowledgeOptionSpec[];
}

/** A read-only view component → components/view/<name>.tsx */
interface ViewComponentSpec {
  name: string;
  source: string;
}

/** A form component → components/form/<name>/{web,ink}.tsx */
interface FormComponentSpec {
  name: string;
  web: string;
  ink: string;
}

interface ComponentsSpec {
  view?: ViewComponentSpec[];
  form?: FormComponentSpec[];
}

interface ScaffoldSpec {
  agentSlug: string;
  agentTitle: string;
  systemPrompt: string;
  functions?: FunctionSpec[];
  tasklists?: TasklistSpec[];
  actions?: ActionSpec[];
  knowledge?: KnowledgeSpec[];
  components?: ComponentsSpec;
  dependencies?: string[];
}

/**
 * Validate that `spec` is a flat ScaffoldSpec. Returns an error string describing
 * the first problem (with a concrete fix), or null if the shape is usable.
 * Designed so a wrong-shape spec produces a message the model can self-correct
 * from on the next turn — NOT a cryptic runtime crash.
 */
function validateSpecShape(spec: any): string | null {
  const SHAPE_HINT =
    ' The spec must be a FLAT object: { agentSlug, agentTitle, systemPrompt, ' +
    'knowledge: [{ domain, field, variable, description, options: [{ slug, content }] }], ' +
    'functions: [{ name, source }], tasklists: [{ name, tasks: [...] }], ' +
    'actions: [{ id, label, description, tasklist }] }. ' +
    'Do NOT nest under `agents`, and knowledge/functions/tasklists/actions/components.view/components.form are ARRAYS, not keyed objects.';

  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    return 'scaffoldSpace: spec must be a plain object.' + SHAPE_HINT;
  }
  // Detect the common nested-shape mistake up front.
  if ('agents' in spec) {
    return 'scaffoldSpace: spec must NOT contain an `agents` key — the agent fields go at the top level (agentSlug/agentTitle/systemPrompt).' + SHAPE_HINT;
  }
  const isNonEmptyStr = (v: any) => typeof v === 'string' && v.trim().length > 0;
  if (!isNonEmptyStr(spec.agentSlug)) {
    return `scaffoldSpace: spec.agentSlug must be a non-empty string (got ${JSON.stringify(spec.agentSlug)}).` + SHAPE_HINT;
  }
  if (!isNonEmptyStr(spec.agentTitle)) {
    return `scaffoldSpace: spec.agentTitle must be a non-empty string (got ${JSON.stringify(spec.agentTitle)}).` + SHAPE_HINT;
  }
  if (!isNonEmptyStr(spec.systemPrompt)) {
    return `scaffoldSpace: spec.systemPrompt must be a non-empty string (got ${JSON.stringify(spec.systemPrompt)}). If you used an \`instruct\` field, rename it to \`systemPrompt\`.` + SHAPE_HINT;
  }
  const arrayFields = ['functions', 'tasklists', 'actions', 'knowledge'];
  for (const f of arrayFields) {
    if (spec[f] !== undefined && !Array.isArray(spec[f])) {
      return `scaffoldSpace: spec.${f} must be an ARRAY (got ${typeof spec[f]}).` + SHAPE_HINT;
    }
  }
  if (spec.components !== undefined) {
    if (typeof spec.components !== 'object' || Array.isArray(spec.components)) {
      return 'scaffoldSpace: spec.components must be an object { view?: [...], form?: [...] }.' + SHAPE_HINT;
    }
    if (spec.components.view !== undefined && !Array.isArray(spec.components.view)) {
      return 'scaffoldSpace: spec.components.view must be an ARRAY of { name, source }.' + SHAPE_HINT;
    }
    if (spec.components.form !== undefined && !Array.isArray(spec.components.form)) {
      return 'scaffoldSpace: spec.components.form must be an ARRAY of { name, web, ink }.' + SHAPE_HINT;
    }
  }
  // Per-element checks for the fields we iterate over and call .replace/.map on.
  for (const k of (spec.knowledge ?? [])) {
    if (!isNonEmptyStr(k?.domain) || !isNonEmptyStr(k?.field) || !isNonEmptyStr(k?.variable)) {
      return 'scaffoldSpace: each knowledge entry needs non-empty string `domain`, `field`, and `variable`.' + SHAPE_HINT;
    }
    if (!Array.isArray(k.options)) {
      return `scaffoldSpace: knowledge "${k.domain}/${k.field}" .options must be an ARRAY of { slug, content } (got ${typeof k.options}).` + SHAPE_HINT;
    }
    for (const opt of k.options) {
      if (!isNonEmptyStr(opt?.slug) || typeof opt?.content !== 'string') {
        return `scaffoldSpace: knowledge "${k.domain}/${k.field}" has an option missing string \`slug\`/\`content\`.` + SHAPE_HINT;
      }
    }
  }
  for (const a of (spec.actions ?? [])) {
    if (!isNonEmptyStr(a?.id) || typeof a?.description !== 'string' || !isNonEmptyStr(a?.tasklist)) {
      return 'scaffoldSpace: each action needs string `id`, `description`, and `tasklist`.' + SHAPE_HINT;
    }
  }
  for (const fn of (spec.functions ?? [])) {
    if (!isNonEmptyStr(fn?.name) || typeof fn?.source !== 'string') {
      return 'scaffoldSpace: each function needs a string `name` and `source`.' + SHAPE_HINT;
    }
  }
  for (const tl of (spec.tasklists ?? [])) {
    if (!isNonEmptyStr(tl?.name) || !Array.isArray(tl?.tasks)) {
      return 'scaffoldSpace: each tasklist needs a string `name` and an ARRAY `tasks`.' + SHAPE_HINT;
    }
    for (const task of tl.tasks) {
      if (!isNonEmptyStr(task?.id) || typeof task?.instruction !== 'string' || typeof task?.output !== 'object' || task?.output === null) {
        return `scaffoldSpace: tasklist "${tl.name}" has a task missing string \`id\`/\`instruction\` or object \`output\`.` + SHAPE_HINT;
      }
    }
  }
  return null;
}

/**
 * Scaffold a complete space directory from a spec object. Creates all required
 * files: agents/<slug>/instruct.md, functions/*.ts, tasklists/<name>/<N>-<id>.md,
 * knowledge/<domain>/<field>/index.md + option .md files, and components/*.tsx.
 * Uses only writeFileRaw and execShell — no Node imports.
 * Re-scaffolding is idempotent: existing files are overwritten.
 *
 * @param dir  Absolute path where the space should be created.
 * @param spec Full spec describing the agent, its actions, tasklists, functions,
 *             knowledge, components, and dependencies.
 * @returns    { ok, dir, error? }
 */
export function scaffoldSpace(dir: string, spec: ScaffoldSpec): { ok: boolean; dir: string; error?: string } {
  try {
    // --- Validate the spec shape FIRST, with actionable errors. ---
    // The #1 failure mode is the model inventing a nested shape
    // ({ agents: { <slug>: { instruct } }, knowledge: { <domain>: {...} } })
    // instead of the required FLAT ScaffoldSpec. Catch that explicitly so the
    // model gets a precise, self-correcting message instead of a cryptic
    // "cannot read property 'replace' of undefined" from deep inside joinPath.
    const specErr = validateSpecShape(spec);
    if (specErr) return { ok: false, dir, error: specErr };

    const agentDir = joinPath(dir, 'agents', spec.agentSlug);
    const functionsDir = joinPath(dir, 'functions');
    const tasklistsDir = joinPath(dir, 'tasklists');

    execShell(`mkdir -p "${agentDir}" "${functionsDir}" "${tasklistsDir}"`);

    // --- Build instruct.md frontmatter ---
    const actions = spec.actions ?? [];
    const functionNames = (spec.functions ?? []).map((f: FunctionSpec) => f.name);

    const fnBlock = functionNames.length > 0
      ? 'functions:\n' + functionNames.map((n: string) => `  - ${n}`).join('\n')
      : 'functions: []';

    // knowledge refs are "<domain>/<field>"
    const knowledgeRefs = (spec.knowledge ?? []).map((k: KnowledgeSpec) => `${k.domain}/${k.field}`);
    const knowledgeBlock = knowledgeRefs.length > 0
      ? 'knowledge:\n' + knowledgeRefs.map((r: string) => `  - ${r}`).join('\n')
      : 'knowledge: []';

    // component names = all view names + all form names
    const componentNames = [
      ...((spec.components?.view ?? []).map((c: ViewComponentSpec) => c.name)),
      ...((spec.components?.form ?? []).map((c: FormComponentSpec) => c.name)),
    ];
    const componentsBlock = componentNames.length > 0
      ? 'components:\n' + componentNames.map((n: string) => `  - ${n}`).join('\n')
      : 'components: []';

    const deps = spec.dependencies ?? [];
    const depsBlock = deps.length > 0
      ? 'dependencies:\n' + deps.map((d: string) => `  - ${d}`).join('\n')
      : 'dependencies: []';

    const actionBlock = actions.length > 0
      ? 'actions:\n' + actions.map((a: ActionSpec) => [
          `  - id: ${a.id}`,
          `    label: "${a.label}"`,
          `    description: "${a.description.replace(/"/g, '\\"')}"`,
          `    tasklist: ${a.tasklist}`,
        ].join('\n')).join('\n')
      : 'actions: []';

    const frontmatter = [
      '---',
      `title: ${spec.agentTitle}`,
      knowledgeBlock,
      fnBlock,
      componentsBlock,
      actionBlock,
      depsBlock,
      '---',
      '',
      spec.systemPrompt,
    ].join('\n');

    const instructWrite = writeFileRaw(joinPath(agentDir, 'instruct.md'), frontmatter);
    if (!instructWrite.ok) {
      return { ok: false, dir, error: `Failed to write instruct.md: ${instructWrite.error}` };
    }

    // --- Write function files ---
    for (const fn of (spec.functions ?? [])) {
      const fnWrite = writeFileRaw(joinPath(functionsDir, `${fn.name}.ts`), fn.source);
      if (!fnWrite.ok) {
        return { ok: false, dir, error: `Failed to write function ${fn.name}: ${fnWrite.error}` };
      }
    }

    // --- Write knowledge tree ---
    for (const k of (spec.knowledge ?? [])) {
      const fieldDir = joinPath(dir, 'knowledge', k.domain, k.field);
      execShell(`mkdir -p "${fieldDir}"`);

      const idxLines = [
        '---',
        `type: ${k.type ?? 'string'}`,
        `variable: ${k.variable}`,
        ...(k.default !== undefined ? [`default: ${k.default}`] : []),
        '---',
        '',
        k.description,
      ];
      const idxWrite = writeFileRaw(joinPath(fieldDir, 'index.md'), idxLines.join('\n'));
      if (!idxWrite.ok) {
        return { ok: false, dir, error: `Failed to write knowledge ${k.domain}/${k.field}/index.md: ${idxWrite.error}` };
      }

      for (const opt of k.options) {
        // normalize: strip stray .md suffix from slug so authors can pass either form
        const optSlug = opt.slug.replace(/\.md$/, '');
        const optWrite = writeFileRaw(joinPath(fieldDir, `${optSlug}.md`), opt.content);
        if (!optWrite.ok) {
          return { ok: false, dir, error: `Failed to write knowledge option ${k.domain}/${k.field}/${optSlug}.md: ${optWrite.error}` };
        }
      }
    }

    // --- Write components ---
    for (const c of (spec.components?.view ?? [])) {
      const viewDir = joinPath(dir, 'components', 'view');
      execShell(`mkdir -p "${viewDir}"`);
      const w = writeFileRaw(joinPath(viewDir, `${c.name}.tsx`), c.source);
      if (!w.ok) return { ok: false, dir, error: `Failed to write view component ${c.name}: ${w.error}` };
    }
    for (const c of (spec.components?.form ?? [])) {
      const formDir = joinPath(dir, 'components', 'form', c.name);
      execShell(`mkdir -p "${formDir}"`);
      const wWeb = writeFileRaw(joinPath(formDir, 'web.tsx'), c.web);
      if (!wWeb.ok) return { ok: false, dir, error: `Failed to write form component ${c.name}/web.tsx: ${wWeb.error}` };
      const wInk = writeFileRaw(joinPath(formDir, 'ink.tsx'), c.ink);
      if (!wInk.ok) return { ok: false, dir, error: `Failed to write form component ${c.name}/ink.tsx: ${wInk.error}` };
    }

    // --- Write tasklist files ---
    for (const tl of (spec.tasklists ?? [])) {
      const tlDir = joinPath(tasklistsDir, tl.name);
      execShell(`mkdir -p "${tlDir}"`);

      tl.tasks.forEach((task: TaskSpec, idx: number) => {
        const num = String(idx + 1).padStart(2, '0');
        const filename = `${num}-${task.id}.md`;

        const outputYaml = Object.entries(task.output)
          .map(([k, v]) => `  ${k}: ${v}`)
          .join('\n');

        const dependsOnYaml = task.dependsOn && task.dependsOn.length > 0
          ? `dependsOn: [${task.dependsOn.join(', ')}]`
          : 'dependsOn: []';

        const lines = [
          '---',
          `id: ${task.id}`,
          'output:',
          outputYaml,
          dependsOnYaml,
          `optional: ${task.optional ?? false}`,
          `goal: ${task.goal ?? false}`,
          ...(task.condition ? [`condition: "${task.condition}"`] : []),
          '---',
          '',
          task.instruction,
        ];

        writeFileRaw(joinPath(tlDir, filename), lines.join('\n'));
      });
    }

    return { ok: true, dir };
  } catch (err: any) {
    return { ok: false, dir, error: String(err?.message ?? err) };
  }
}
