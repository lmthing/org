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

/** Turn a title like "Edge SLM Advisor" into a slug "edge_slm_advisor". */
function slugify(s: string): string {
  return String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'agent';
}

/** Turn a slug like "humanoid_robotics_analyst" into "Humanoid Robotics Analyst". */
function titleizeSlug(slug: string): string {
  return slug
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Strip a trailing file extension models often bake into a name/key (.md/.ts/.tsx/.js/.jsx). */
function stripExt(name: string): string {
  return name.replace(/\.(md|tsx?|jsx?)$/i, '');
}

/** Build a camelCase variable name from parts, e.g. ['platforms'] → "platformsKnowledge". */
function camelVar(...parts: string[]): string {
  const words = parts.flatMap((p) => p.split(/[^a-zA-Z0-9]+/)).filter(Boolean);
  return words
    .map((w, i) => (i === 0 ? w.charAt(0).toLowerCase() + w.slice(1) : w.charAt(0).toUpperCase() + w.slice(1)))
    .join('');
}

/**
 * Models reliably emit an "intuitive" NESTED spec shape instead of the flat
 * ScaffoldSpec — keyed maps everywhere, and `instruct`/`code`/`content` instead
 * of `systemPrompt`/`source`. Rather than fight that prior with prompting (which
 * fails), accept it: detect the nested shape and lift it into the flat shape.
 * An already-flat spec (top-level `agentSlug`) passes through unchanged, so the
 * documented API and existing callers are unaffected.
 *
 * Recognized nested shape:
 *   { agents: { <slug>: { instruct|systemPrompt, title?, actions?: { <id>: { tasklist, description, label? } } } },
 *     knowledge?: { <domain>: { <field>: { index?|description?, variable?, default?, type?, options: { <slug>: { content }|string } } } },
 *     functions?: { <name>: { code|source }|string },
 *     components?: { <Name>: { type: 'view'|'form', code|source|web|ink } },
 *     tasklists?: { <name>: { tasks: [ { id, content|instruction, output?, goal?, dependsOn?, optional?, condition? } ] } },
 *     actions?: { <id>: {...} }   // also accepted at top level
 *   }
 */
function normalizeSpec(spec: any): any {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return spec;
  if (typeof spec.agentSlug === 'string') {
    // Already flat — strip any spurious `agents` key the model may have left alongside agentSlug.
    if ('agents' in spec) { const { agents: _a, ...rest } = spec; return rest; }
    return spec;
  }
  if (!spec.agents || typeof spec.agents !== 'object') return spec;

  const isArr = Array.isArray;
  // `agents` may be a keyed map { <slug>: {...} } OR an array [{ slug, title, ... }].
  let agentSlug: string | undefined;
  let agent: any;
  if (isArr(spec.agents)) {
    agent = spec.agents[0] ?? {};
    agentSlug = agent.slug ?? agent.agentSlug ?? spec.spaceKey ?? slugify(agent.title ?? spec.spaceName ?? '');
  } else {
    agentSlug = Object.keys(spec.agents)[0];
    agent = (agentSlug ? spec.agents[agentSlug] : {}) ?? {};
  }

  // actions: { <id>: { tasklist, description, label? } } → [{ id, label, description, tasklist }]
  const normActions = (src: any): any[] | undefined => {
    if (src === undefined) return undefined;
    if (isArr(src)) return src;
    if (typeof src !== 'object') return undefined;
    return Object.entries(src).map(([id, v]: [string, any]) => ({
      id,
      label: v?.label ?? titleizeSlug(id),
      description: v?.description ?? '',
      tasklist: v?.tasklist ?? id,
    }));
  };

  // Pull a text body out of a value that may be a bare string or an object using
  // any of the field names models reach for.
  const bodyOf = (v: any): string =>
    typeof v === 'string' ? v : (v?.content ?? v?.source ?? v?.code ?? v?.body ?? v?.text ?? v?.markdown ?? v?.instruction ?? '');

  // One field → a flat knowledge entry. Options may be a keyed map, an array of
  // { slug|value|name, content } objects, or bare strings; option keys may carry .md.
  const fieldToEntry = (domain: string, fieldName: string, fv: any): any => {
    fv = fv ?? {};
    let optsRaw = fv.options ?? fv.files ?? fv.contents ?? fv.pages ?? fv.docs ?? fv.option ?? {};
    // Field emitted as a flat { 'index.md': ..., 'file.md': ... } map with no `options`.
    if (!isArr(optsRaw) && typeof optsRaw === 'object' && Object.keys(optsRaw).length === 0) {
      const mdKeys = Object.keys(fv).filter((k) => k.endsWith('.md') || k === 'index');
      if (mdKeys.length > 0) optsRaw = Object.fromEntries(mdKeys.map((k) => [k, fv[k]]));
    }
    const optEntries: Array<[string, any]> = isArr(optsRaw)
      ? optsRaw.map((o: any, i: number): [string, any] => [String(o?.slug ?? o?.value ?? o?.name ?? (i + 1)), o])
      : (Object.entries(optsRaw ?? {}) as Array<[string, any]>);
    const options = optEntries
      .filter((e) => stripExt(e[0]) !== 'index')
      .map((e) => ({ slug: stripExt(e[0]), content: bodyOf(e[1]) }));
    const indexContent = fv.description ?? fv.index ?? fv['index.md'] ?? `${domain} ${fieldName}`;
    return {
      domain,
      field: stripExt(fieldName),
      type: fv.type ?? 'string',
      variable: fv.variable ?? camelVar(fieldName, 'knowledge'),
      default: fv.default ?? options[0]?.slug,
      description: indexContent,
      options,
    };
  };

  // knowledge accepts: { <domain>: { <field>: {...} } } (map), [{ domain, field, options }]
  // (flat array), or [{ domain, fields: [{ name, options }] | { <field>: {...} } }] (array of
  // domains each carrying multiple fields — the shape models emit alongside agents:[...]).
  const normKnowledge = (src: any): any[] | undefined => {
    if (src === undefined) return undefined;
    const out: any[] = [];
    if (isArr(src)) {
      for (const entry of src) {
        if (!entry || typeof entry !== 'object') continue;
        const domain = entry.domain ?? entry.name ?? '';
        if (isArr(entry.fields)) {
          for (const f of entry.fields) out.push(fieldToEntry(domain, f?.name ?? f?.field ?? '', f));
        } else if (entry.fields && typeof entry.fields === 'object') {
          for (const [fname, f] of Object.entries(entry.fields)) out.push(fieldToEntry(domain, fname, f));
        } else if (entry.field !== undefined) {
          out.push(fieldToEntry(domain, entry.field, entry)); // already-flat entry
        }
      }
      return out;
    }
    if (typeof src !== 'object') return undefined;
    for (const [domain, fields] of Object.entries(src)) {
      if (!fields || typeof fields !== 'object') continue;
      for (const [field, f] of Object.entries(fields as any)) out.push(fieldToEntry(domain, field, f));
    }
    return out;
  };

  // functions: { <name>: { code|source }|string } → [{ name, source }]. Name may carry .ts.
  const normFunctions = (src: any): any[] | undefined => {
    if (src === undefined) return undefined;
    if (isArr(src)) return src.map((v: any) => ({ name: stripExt(v?.name ?? ''), source: bodyOf(v) }));
    if (typeof src !== 'object') return undefined;
    return Object.entries(src).map(([name, v]: [string, any]) => ({ name: stripExt(name), source: bodyOf(v) }));
  };

  // components: { <Name>: { type, code|source|web|ink }|string } → { view: [...], form: [...] }.
  // Values may be bare source strings; names may carry .tsx; type is inferred from a
  // form-ish name when absent.
  // A collection is either an ARRAY of {name,...} or a keyed object-map { <Name>: {...} }.
  const compEntries = (coll: any): Array<[string, any]> => {
    if (coll == null) return [];
    if (isArr(coll)) return coll.map((c: any, i: number): [string, any] => [c?.name ?? String(i), c]);
    if (typeof coll === 'object') return Object.entries(coll);
    return [];
  };
  const toViewArr = (coll: any): any[] =>
    compEntries(coll).map(([rawName, c]) => ({ name: stripExt(rawName), source: bodyOf(c) }));
  const toFormArr = (coll: any): any[] =>
    compEntries(coll).map(([rawName, c]) => {
      const cv: any = typeof c === 'object' && c !== null ? c : {};
      const body = bodyOf(c);
      return { name: stripExt(rawName), web: cv.web ?? body, ink: cv.ink ?? body };
    });
  const normComponents = (src: any): any => {
    if (src === undefined) return undefined;
    if (typeof src !== 'object') return undefined;
    // Split shape { view, form } — normalize EACH sub-collection. The model reliably
    // emits view/form as keyed object-maps (not arrays); the old code returned them
    // as-is, so validateSpecShape rejected them. Normalize array OR map alike.
    if (!isArr(src) && ('view' in src || 'form' in src)) {
      return { view: toViewArr((src as any).view), form: toFormArr((src as any).form) };
    }
    // Flat shape { <Name>: {...}|string } or [ {name,...} ] — split by form detection.
    const view: any[] = [];
    const form: any[] = [];
    for (const [rawName, c] of compEntries(src)) {
      const name = stripExt(rawName);
      const cv: any = typeof c === 'object' && c !== null ? c : {};
      const body = bodyOf(c);
      // Also detect form components by source content — models often pass bare source strings
      // with <Form> at the root without adding type:'form' or naming them *Form.
      const isForm = cv.type === 'form' || !!cv.web || !!cv.ink || /form$/i.test(name) || /<Form[\s>]/.test(body);
      if (isForm) {
        form.push({ name, web: cv.web ?? body, ink: cv.ink ?? body });
      } else {
        view.push({ name, source: body });
      }
    }
    return { view, form };
  };

  // tasklists: accepts { <name>: { tasks: [...] } }, { <name>: { tasks: { "N-id": body } } },
  // or { <name>: { "N-id.md": body } } (a bare map of task files). → [{ name, tasks: [...] }].
  const META_KEYS = ['description', 'label', 'goal', 'name', 'output', 'title', 'tasks'];
  const normTasklists = (src: any): any[] | undefined => {
    if (src === undefined) return undefined;
    if (isArr(src)) return src;
    if (typeof src !== 'object') return undefined;
    return Object.entries(src).map(([name, tl]: [string, any]) => {
      // Build a list of [key, taskValue] pairs from whatever shape was used.
      let entries: Array<[string, any]>;
      if (isArr(tl)) entries = tl.map((t: any, i: number) => [t?.id ?? String(i + 1), t]);
      else if (isArr(tl?.tasks)) entries = tl.tasks.map((t: any, i: number) => [t?.id ?? String(i + 1), t]);
      else if (tl?.tasks && typeof tl.tasks === 'object') entries = Object.entries(tl.tasks);
      else if (tl && typeof tl === 'object') entries = Object.entries(tl).filter(([k]) => !META_KEYS.includes(k));
      else entries = [];

      const tasks = entries.map(([key, t]: [string, any]) => {
        const idSrc = t && typeof t === 'object' && t.id ? t.id : key;
        // strip a baked extension and any leading "N-"/"N_" ordinal
        const id = stripExt(String(idSrc)).replace(/^\d+[-_]?/, '') || 'task';
        const out = t && typeof t === 'object' && t.output && typeof t.output === 'object' ? t.output : { result: 'string' };
        return {
          id,
          instruction: bodyOf(t),
          output: out,
          dependsOn: t?.dependsOn,
          goal: t?.goal === true,
          optional: t?.optional,
          condition: t?.condition,
        };
      });
      // Guarantee a goal task: if none is flagged, the last task is the goal.
      if (tasks.length > 0 && !tasks.some((t: any) => t.goal)) tasks[tasks.length - 1].goal = true;
      return { name, tasks };
    });
  };

  return {
    agentSlug,
    agentTitle: agent.agentTitle ?? agent.title ?? spec.spaceName ?? (agentSlug ? titleizeSlug(agentSlug) : undefined),
    systemPrompt: agent.systemPrompt ?? agent.instruct ?? agent.prompt ?? agent.description,
    actions: normActions(agent.actions ?? spec.actions),
    knowledge: normKnowledge(spec.knowledge),
    functions: normFunctions(spec.functions),
    components: normComponents(spec.components),
    tasklists: normTasklists(spec.tasklists),
    dependencies: spec.dependencies,
  };
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
    // --- Accept the nested shape models naturally emit, then validate. ---
    // Models reliably produce { agents: { <slug>: { instruct } }, ... } instead
    // of the flat ScaffoldSpec. normalizeSpec lifts that into the flat shape
    // (no-op when already flat); validateSpecShape then catches anything still
    // malformed with an actionable message instead of a cryptic crash.
    spec = normalizeSpec(spec);
    const specErr = validateSpecShape(spec);
    if (specErr) return { ok: false, dir, error: specErr };

    const agentDir = joinPath(dir, 'agents', spec.agentSlug);
    const functionsDir = joinPath(dir, 'functions');
    const tasklistsDir = joinPath(dir, 'tasklists');

    execShell(`mkdir -p "${agentDir}" "${functionsDir}" "${tasklistsDir}"`);

    // --- Build instruct.md frontmatter ---
    const actions = spec.actions ?? [];
    const functionNames = (spec.functions ?? []).map((f: FunctionSpec) => stripExt(f.name));

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
      ...((spec.components?.view ?? []).map((c: ViewComponentSpec) => stripExt(c.name))),
      ...((spec.components?.form ?? []).map((c: FormComponentSpec) => stripExt(c.name))),
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

    // Structural robustness for less-capable models: if the agent has exactly one
    // action (or the spec names one explicitly), declare it as defaultAction so a
    // freeform session runs that action's tasklist deterministically instead of
    // relying on the model to write orchestration code. Only set it for actions that
    // actually have a tasklist.
    const explicitDefault = typeof spec.defaultAction === 'string' ? spec.defaultAction : undefined;
    const soleAction = actions.length === 1 ? actions[0]!.id : undefined;
    const defaultActionId = (explicitDefault && actions.some((a: ActionSpec) => a.id === explicitDefault))
      ? explicitDefault
      : soleAction;
    const defaultActionBlock = defaultActionId ? `defaultAction: ${defaultActionId}` : '';

    const frontmatter = [
      '---',
      `title: ${spec.agentTitle}`,
      knowledgeBlock,
      fnBlock,
      componentsBlock,
      ...(defaultActionBlock ? [defaultActionBlock] : []),
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
      const fnName = stripExt(fn.name);
      const fnWrite = writeFileRaw(joinPath(functionsDir, `${fnName}.ts`), fn.source);
      if (!fnWrite.ok) {
        return { ok: false, dir, error: `Failed to write function ${fnName}: ${fnWrite.error}` };
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
      const w = writeFileRaw(joinPath(viewDir, `${stripExt(c.name)}.tsx`), c.source);
      if (!w.ok) return { ok: false, dir, error: `Failed to write view component ${c.name}: ${w.error}` };
    }
    for (const c of (spec.components?.form ?? [])) {
      const formDir = joinPath(dir, 'components', 'form', stripExt(c.name));
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
