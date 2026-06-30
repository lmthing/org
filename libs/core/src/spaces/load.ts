import { readFile, readdir, stat } from 'node:fs/promises';
import { join, basename, extname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseFrontmatter } from './frontmatter.js';

export interface Space {
  dir: string;
  packageName?: string; // npm package name from own package.json
  agents: Record<string, AgentDef>;
  tasklists: Record<string, TasklistDir>; // slug -> sorted md files
  functions: Record<string, string>; // name -> original TS source (always)
  functionsBundled: Record<string, string>; // name -> bundled JS (only when node_modules present)
  nodeModulesDir?: string; // set when space has package.json with installed deps
  dependentSpaces: Record<string, Space>; // packageName -> loaded Space for npm space deps
  components: {
    view: Record<string, string>; // name -> source
    form: Record<string, string>; // name -> single-file source (components/form/<Name>.tsx)
  };
  knowledge: KnowledgeTree;
}

export interface AgentDef {
  slug: string;
  title: string;
  instructBody: string; // body of instruct.md
  /** Body of charter.md — short, fork-safe identity/guardrails. Injected into the top-level
   *  prompt AND every fork (unlike instructBody, which is top-level only). Empty when absent. */
  charterBody: string;
  actions: ActionDef[];
  /** Other agents this agent can delegate to. Entries may carry an `#action`
   *  suffix or `npm:` prefix — raw strings only, parsing happens downstream
   *  (WP-3 resolveDirectDeps). Read from the `canDelegateTo:` frontmatter key,
   *  falling back to the deprecated `dependencies:` key when absent. */
  canDelegateTo: string[];
  config: AgentConfig;
  /** When set, a freeform session for this agent runs this action's tasklist
   *  deterministically (host-driven) instead of the model-driven turn loop — a
   *  structural guarantee for less-capable models that won't follow routing prose. */
  defaultAction?: string;
}

export interface ActionDef {
  id: string;
  label: string;
  description: string;
  tasklist: string;
}

export interface AgentConfig {
  knowledge: string[];
  functions: string[];
  components: string[];
}

export interface TasklistDir {
  slug: string;
  files: string[]; // sorted absolute paths to .md files (NN-<id>.md only — index.md excluded)
  /** Body of tasklists/<name>/index.md, when present. */
  description?: string;
  /** Input schema declared in tasklists/<name>/index.md frontmatter (field name -> type string). */
  input?: Record<string, string>;
}

export interface KnowledgeTree {
  domains: Record<string, KnowledgeDomain>;
}

export interface KnowledgeDomain {
  slug: string;
  fields: Record<string, KnowledgeField>;
  /** Body of knowledge/<domain>/index.md, when present. */
  description?: string;
}

export interface KnowledgeField {
  slug: string;
  type: string;
  variableName: string;
  default?: unknown;
  options: Record<string, string>; // option slug -> file path
  /** Body of knowledge/<domain>/<field>/index.md — the field's OVERVIEW. Surfaced in
   *  the system prompt so the agent always has the field summary; the option files
   *  (aspects) are loaded on demand. */
  description?: string;
}

async function dirExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}

async function listDir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

async function loadFunctions(
  dir: string,
  nodeModulesDir?: string,
): Promise<{ functions: Record<string, string>; functionsBundled: Record<string, string> }> {
  const functionsDir = join(dir, 'functions');
  if (!(await dirExists(functionsDir))) return { functions: {}, functionsBundled: {} };

  const files = await listDir(functionsDir);
  const functions: Record<string, string> = {};
  const functionsBundled: Record<string, string> = {};

  for (const file of files) {
    if (file.endsWith('.ts') || file.endsWith('.tsx')) {
      const name = basename(file, extname(file));
      const src = await readFile(join(functionsDir, file), 'utf8');
      functions[name] = src;

      if (nodeModulesDir) {
        const { build } = await import('esbuild');
        const buildResult = await build({
          stdin: {
            contents: src,
            loader: file.endsWith('.tsx') ? 'tsx' : 'ts',
            resolveDir: functionsDir,
            sourcefile: file,
          },
          bundle: true,
          format: 'esm',
          write: false,
          platform: 'browser',
          absWorkingDir: resolve(dir),
        });
        functionsBundled[name] = buildResult.outputFiles[0]!.text;
      }
    }
  }

  return { functions, functionsBundled };
}

async function loadComponents(dir: string): Promise<Space['components']> {
  const componentsDir = join(dir, 'components');
  const view: Record<string, string> = {};
  const form: Record<string, string> = {};

  if (!(await dirExists(componentsDir))) {
    return { view, form };
  }

  // View components — one `<Name>.tsx` file each.
  const viewDir = join(componentsDir, 'view');
  if (await dirExists(viewDir)) {
    const files = await listDir(viewDir);
    for (const file of files) {
      if (file.endsWith('.tsx') || file.endsWith('.ts')) {
        const name = basename(file, extname(file));
        const source = await readFile(join(viewDir, file), 'utf8');
        view[name] = source;
      }
    }
  }

  // Form components — one `<Name>.tsx` file each (SPACE-SPEC: the legacy
  // `<Name>/{web,ink}.tsx` split is removed). A directory entry that still holds
  // the old layout is read defensively (prefer web.tsx) so not-yet-migrated
  // on-disk spaces keep loading.
  const formDir = join(componentsDir, 'form');
  if (await dirExists(formDir)) {
    const entries = await listDir(formDir);
    for (const entry of entries) {
      const entryPath = join(formDir, entry);
      if (entry.endsWith('.tsx') || entry.endsWith('.ts')) {
        const name = basename(entry, extname(entry));
        form[name] = await readFile(entryPath, 'utf8');
      } else if (await dirExists(entryPath)) {
        // Legacy web/ink split — read web.tsx (or ink.tsx) as the single source.
        const webPath = join(entryPath, 'web.tsx');
        const inkPath = join(entryPath, 'ink.tsx');
        if (await fileExists(webPath)) form[entry] = await readFile(webPath, 'utf8');
        else if (await fileExists(inkPath)) form[entry] = await readFile(inkPath, 'utf8');
      }
    }
  }

  return { view, form };
}

async function loadKnowledge(dir: string): Promise<KnowledgeTree> {
  const knowledgeDir = join(dir, 'knowledge');
  const domains: Record<string, KnowledgeDomain> = {};

  if (!(await dirExists(knowledgeDir))) {
    return { domains };
  }

  const domainSlugs = await listDir(knowledgeDir);
  for (const domainSlug of domainSlugs) {
    const domainDir = join(knowledgeDir, domainSlug);
    if (!(await dirExists(domainDir))) continue;

    const fields: Record<string, KnowledgeField> = {};
    const fieldSlugs = await listDir(domainDir);

    for (const fieldSlug of fieldSlugs) {
      const fieldDir = join(domainDir, fieldSlug);
      if (!(await dirExists(fieldDir))) continue;

      let type = 'string';
      let variableName = fieldSlug;
      let defaultValue: unknown;
      let fieldDescription: string | undefined;

      const metaPath = join(fieldDir, 'index.md');
      if (await fileExists(metaPath)) {
        const raw = await readFile(metaPath, 'utf8');
        const { data, body } = parseFrontmatter(raw, metaPath);
        if (typeof data['type'] === 'string') type = data['type'];
        if (typeof data['variable'] === 'string') variableName = data['variable'];
        if ('default' in data) defaultValue = data['default'];
        if (body && body.trim()) fieldDescription = body.trim();
      }

      // Collect options (all .md files except index.md)
      const options: Record<string, string> = {};
      const optionFiles = await listDir(fieldDir);
      for (const optFile of optionFiles) {
        if (!optFile.endsWith('.md') || optFile === 'index.md') continue;
        const optionSlug = basename(optFile, '.md');
        const optionPath = join(fieldDir, optFile);
        validateKnowledgeOptionFrontmatter(await readFile(optionPath, 'utf8'), optionPath);
        options[optionSlug] = optionPath;
      }

      const field: KnowledgeField = {
        slug: fieldSlug,
        type,
        variableName,
        options,
      };
      if (defaultValue !== undefined) {
        field.default = defaultValue;
      }
      if (fieldDescription) {
        field.description = fieldDescription;
      }
      fields[fieldSlug] = field;
    }

    const domain: KnowledgeDomain = { slug: domainSlug, fields };
    const domainIndexPath = join(domainDir, 'index.md');
    if (await fileExists(domainIndexPath)) {
      const raw = await readFile(domainIndexPath, 'utf8');
      const { body } = parseFrontmatter(raw, domainIndexPath);
      if (body) domain.description = body;
    }

    domains[domainSlug] = domain;
  }

  return { domains };
}

/** Allowed frontmatter keys for a knowledge option file (knowledge/<domain>/<field>/<slug>.md). */
const KNOWLEDGE_OPTION_ALLOWED_KEYS = new Set(['description', 'icon', 'color', 'label']);

/**
 * Validate a knowledge option file's frontmatter against the spec allow-list:
 * `description` is required when frontmatter is present; `icon`/`color`/`label`
 * are optional; no other keys are allowed. Plain markdown (no frontmatter) is
 * always valid. Throws (fail-loud, matching parseFrontmatter's YAML errors).
 */
export function validateKnowledgeOptionFrontmatter(raw: string, source: string): void {
  const { data } = parseFrontmatter(raw, source);
  if (Object.keys(data).length === 0) return; // plain markdown option, no frontmatter

  if (typeof data['description'] !== 'string' || data['description'].length === 0) {
    throw new Error(`Knowledge option "${source}" has frontmatter but is missing required key "description"`);
  }

  const unknownKeys = Object.keys(data).filter((k) => !KNOWLEDGE_OPTION_ALLOWED_KEYS.has(k));
  if (unknownKeys.length > 0) {
    throw new Error(
      `Knowledge option "${source}" has disallowed frontmatter key(s): ${unknownKeys.join(', ')}. Allowed keys: description (required), icon, color, label`,
    );
  }
}

async function loadTasklists(dir: string): Promise<Record<string, TasklistDir>> {
  const tasklistsDir = join(dir, 'tasklists');
  const result: Record<string, TasklistDir> = {};

  if (!(await dirExists(tasklistsDir))) return result;

  const slugs = await listDir(tasklistsDir);
  for (const slug of slugs) {
    const tlDir = join(tasklistsDir, slug);
    if (!(await dirExists(tlDir))) continue;

    const files = await listDir(tlDir);
    const mdFiles = files
      .filter((f) => f.endsWith('.md') && f !== 'index.md')
      .sort()
      .map((f) => join(tlDir, f));

    const tasklist: TasklistDir = { slug, files: mdFiles };

    const indexPath = join(tlDir, 'index.md');
    if (await fileExists(indexPath)) {
      const raw = await readFile(indexPath, 'utf8');
      const { data, body } = parseFrontmatter(raw, indexPath);
      if (body) tasklist.description = body;
      if (data['input'] && typeof data['input'] === 'object' && !Array.isArray(data['input'])) {
        const input: Record<string, string> = {};
        for (const [k, v] of Object.entries(data['input'] as Record<string, unknown>)) {
          input[k] = String(v);
        }
        tasklist.input = input;
      }
    }

    result[slug] = tasklist;
  }

  return result;
}

async function loadAgent(agentsDir: string, slug: string): Promise<AgentDef> {
  const agentDir = join(agentsDir, slug);

  const instructPath = join(agentDir, 'instruct.md');
  let instructBody = '';
  let charterBody = '';
  let title = slug;
  const actions: ActionDef[] = [];
  const config: AgentConfig = { knowledge: [], functions: [], components: [] };
  const canDelegateTo: string[] = [];
  let defaultAction: string | undefined;

  if (await fileExists(instructPath)) {
    const raw = await readFile(instructPath, 'utf8');
    const { data, body } = parseFrontmatter(raw, instructPath);
    instructBody = body;
    if (typeof data['title'] === 'string') title = data['title'];
    if (typeof data['defaultAction'] === 'string') defaultAction = data['defaultAction'];
    if (Array.isArray(data['knowledge'])) config.knowledge = data['knowledge'].map(String);
    if (Array.isArray(data['functions'])) config.functions = data['functions'].map(String);
    if (Array.isArray(data['components'])) config.components = data['components'].map(String);
    // `canDelegateTo` is the current key; `dependencies` is deprecated (one-release compat).
    if (Array.isArray(data['canDelegateTo'])) {
      canDelegateTo.push(...data['canDelegateTo'].map(String));
    } else if (Array.isArray(data['dependencies'])) {
      canDelegateTo.push(...data['dependencies'].map(String));
    }
    if (Array.isArray(data['actions'])) {
      for (const action of data['actions'] as unknown[]) {
        if (typeof action === 'object' && action !== null) {
          const a = action as Record<string, unknown>;
          actions.push({
            id: String(a['id'] ?? ''),
            label: String(a['label'] ?? ''),
            description: String(a['description'] ?? ''),
            tasklist: String(a['tasklist'] ?? ''),
          });
        }
      }
    }
  }

  // charter.md (optional): fork-safe identity/guardrails, no frontmatter required.
  const charterPath = join(agentDir, 'charter.md');
  if (await fileExists(charterPath)) {
    const raw = await readFile(charterPath, 'utf8');
    const { body } = parseFrontmatter(raw, charterPath);
    charterBody = body.trim();
  }

  return { slug, title, instructBody, charterBody, actions, canDelegateTo, config, defaultAction };
}

export interface LoadSpaceOpts {
  /** When false, a space without an agents/ directory is allowed (function-only
   *  system spaces). Defaults to true. */
  requireAgents?: boolean;
}

export async function loadSpace(dir: string, opts: LoadSpaceOpts = {}): Promise<Space> {
  const requireAgents = opts.requireAgents ?? true;
  const agentsDir = join(dir, 'agents');
  const hasAgentsDir = await dirExists(agentsDir);

  if (!hasAgentsDir && requireAgents) {
    throw new Error(`Space at "${dir}" must have an agents/ directory`);
  }

  const agentSlugs = hasAgentsDir ? await listDir(agentsDir) : [];
  const agentDirs = [];
  for (const slug of agentSlugs) {
    if (await dirExists(join(agentsDir, slug))) {
      agentDirs.push(slug);
    }
  }

  if (agentDirs.length === 0 && requireAgents) {
    throw new Error(`Space at "${dir}" must have at least one agent`);
  }

  // Detect package.json, install deps, read own name, load npm space deps
  const pkgJsonPath = join(dir, 'package.json');
  const nodeModulesPath = join(dir, 'node_modules');
  let packageName: string | undefined;
  let nodeModulesDir: string | undefined;
  const dependentSpaces: Record<string, Space> = {};

  if (await fileExists(pkgJsonPath)) {
    const pkgData = JSON.parse(await readFile(pkgJsonPath, 'utf8')) as Record<string, unknown>;
    if (typeof pkgData['name'] === 'string') packageName = pkgData['name'];

    // Only install when the space actually declares dependencies. A package.json
    // with no deps (common for self-contained demo/preview spaces) must NOT
    // trigger `npm install` — that needlessly fails on offline/egress-less pods.
    const declaredDeps = {
      ...((pkgData['dependencies'] as Record<string, string> | undefined) ?? {}),
      ...((pkgData['devDependencies'] as Record<string, string> | undefined) ?? {}),
    };
    const hasDeps = Object.keys(declaredDeps).length > 0;

    if (hasDeps && !(await dirExists(nodeModulesPath))) {
      const result = spawnSync('npm', ['install'], { cwd: dir, stdio: 'inherit' });
      if (result.status !== 0) {
        throw new Error(`Failed to install dependencies for space at "${dir}"`);
      }
    }

    if (await dirExists(nodeModulesPath)) {
      nodeModulesDir = nodeModulesPath;

      // Load npm dependencies that are spaces (have an agents/ directory)
      const allDeps = {
        ...((pkgData['dependencies'] as Record<string, string> | undefined) ?? {}),
      };
      for (const depName of Object.keys(allDeps)) {
        const depDir = join(dir, 'node_modules', depName);
        if (await dirExists(join(depDir, 'agents'))) {
          try {
            dependentSpaces[depName] = await loadSpace(depDir);
          } catch {
            // Not a valid space, skip
          }
        }
      }
    }
  }

  // Load all agents
  const agents: Record<string, AgentDef> = {};
  for (const slug of agentDirs) {
    agents[slug] = await loadAgent(agentsDir, slug);
  }

  // Load tasklists
  const tasklists = await loadTasklists(dir);

  // Validate: every action.tasklist resolves
  for (const agent of Object.values(agents)) {
    for (const action of agent.actions) {
      if (action.tasklist && !(action.tasklist in tasklists)) {
        throw new Error(
          `Agent "${agent.slug}" action "${action.id}" references tasklist "${action.tasklist}" which does not exist`,
        );
      }
    }
  }

  // Load functions (original TS source always; bundled JS when node_modules available)
  const { functions, functionsBundled } = await loadFunctions(dir, nodeModulesDir);

  // Load components
  const components = await loadComponents(dir);

  // Load knowledge
  const knowledge = await loadKnowledge(dir);

  // Validate: every agent-declared reference resolves to a real file/dir.
  // (functions, components, and knowledge are all checked — previously only
  //  functions were validated and bad component/knowledge refs failed silently.)
  for (const agent of Object.values(agents)) {
    for (const fnName of agent.config.functions) {
      if (!(fnName in functions)) {
        throw new Error(
          `Agent "${agent.slug}" requires function "${fnName}" but it was not found in functions/`,
        );
      }
    }
    for (const compName of agent.config.components) {
      if (!(compName in components.view) && !(compName in components.form)) {
        throw new Error(
          `Agent "${agent.slug}" requires component "${compName}" but it was not found in components/view or components/form`,
        );
      }
    }
    for (const knowledgeRef of agent.config.knowledge) {
      const [domainSlug, fieldSlug, optionSlug] = knowledgeRef.split('/');
      const domain = domainSlug ? knowledge.domains[domainSlug] : undefined;
      if (!domain) {
        throw new Error(
          `Agent "${agent.slug}" references knowledge "${knowledgeRef}" but domain "${domainSlug}" was not found in knowledge/`,
        );
      }
      const field = fieldSlug ? domain.fields[fieldSlug] : undefined;
      if (fieldSlug && !field) {
        throw new Error(
          `Agent "${agent.slug}" references knowledge "${knowledgeRef}" but field "${fieldSlug}" was not found in domain "${domainSlug}"`,
        );
      }
      if (optionSlug && field && !(optionSlug in field.options)) {
        throw new Error(
          `Agent "${agent.slug}" references knowledge "${knowledgeRef}" but option "${optionSlug}" was not found in field "${fieldSlug}" of domain "${domainSlug}"`,
        );
      }
    }
  }

  return { dir, packageName, agents, tasklists, functions, functionsBundled, nodeModulesDir, dependentSpaces, components, knowledge };
}
