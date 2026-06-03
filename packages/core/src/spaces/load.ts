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
    form: Record<string, { web: string; ink: string }>; // name -> {web, ink} sources
  };
  knowledge: KnowledgeTree;
}

export interface AgentDef {
  slug: string;
  title: string;
  instructBody: string; // body of instruct.md
  actions: ActionDef[];
  dependencies: string[]; // "space/agent" strings
  config: AgentConfig;
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
  files: string[]; // sorted absolute paths to .md files
}

export interface KnowledgeTree {
  domains: Record<string, KnowledgeDomain>;
}

export interface KnowledgeDomain {
  slug: string;
  fields: Record<string, KnowledgeField>;
}

export interface KnowledgeField {
  slug: string;
  type: string;
  variableName: string;
  default?: unknown;
  options: Record<string, string>; // option slug -> file path
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
  const form: Record<string, { web: string; ink: string }> = {};

  if (!(await dirExists(componentsDir))) {
    return { view, form };
  }

  // View components
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

  // Form components
  const formDir = join(componentsDir, 'form');
  if (await dirExists(formDir)) {
    const formNames = await listDir(formDir);
    for (const name of formNames) {
      const nameDir = join(formDir, name);
      if (await dirExists(nameDir)) {
        const webPath = join(nameDir, 'web.tsx');
        const inkPath = join(nameDir, 'ink.tsx');
        const webExists = await fileExists(webPath);
        const inkExists = await fileExists(inkPath);
        if (webExists || inkExists) {
          const web = webExists ? await readFile(webPath, 'utf8') : '';
          const ink = inkExists ? await readFile(inkPath, 'utf8') : '';
          form[name] = { web, ink };
        }
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

      const metaPath = join(fieldDir, 'index.md');
      if (await fileExists(metaPath)) {
        const raw = await readFile(metaPath, 'utf8');
        const { data } = parseFrontmatter(raw);
        if (typeof data['type'] === 'string') type = data['type'];
        if (typeof data['variable'] === 'string') variableName = data['variable'];
        if ('default' in data) defaultValue = data['default'];
      }

      // Collect options (all .md files except index.md)
      const options: Record<string, string> = {};
      const optionFiles = await listDir(fieldDir);
      for (const optFile of optionFiles) {
        if (!optFile.endsWith('.md') || optFile === 'index.md') continue;
        const optionSlug = basename(optFile, '.md');
        options[optionSlug] = join(fieldDir, optFile);
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
      fields[fieldSlug] = field;
    }

    domains[domainSlug] = { slug: domainSlug, fields };
  }

  return { domains };
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
      .filter((f) => f.endsWith('.md'))
      .sort()
      .map((f) => join(tlDir, f));

    result[slug] = { slug, files: mdFiles };
  }

  return result;
}

async function loadAgent(agentsDir: string, slug: string): Promise<AgentDef> {
  const agentDir = join(agentsDir, slug);

  const instructPath = join(agentDir, 'instruct.md');
  let instructBody = '';
  let title = slug;
  const actions: ActionDef[] = [];
  const config: AgentConfig = { knowledge: [], functions: [], components: [] };
  const dependencies: string[] = [];

  if (await fileExists(instructPath)) {
    const raw = await readFile(instructPath, 'utf8');
    const { data, body } = parseFrontmatter(raw);
    instructBody = body;
    if (typeof data['title'] === 'string') title = data['title'];
    if (Array.isArray(data['knowledge'])) config.knowledge = data['knowledge'].map(String);
    if (Array.isArray(data['functions'])) config.functions = data['functions'].map(String);
    if (Array.isArray(data['components'])) config.components = data['components'].map(String);
    if (Array.isArray(data['dependencies'])) dependencies.push(...data['dependencies'].map(String));
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

  return { slug, title, instructBody, actions, dependencies, config };
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

    if (!(await dirExists(nodeModulesPath))) {
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

  // Validate: every config.functions entry has a file
  for (const agent of Object.values(agents)) {
    for (const fnName of agent.config.functions) {
      if (!(fnName in functions)) {
        throw new Error(
          `Agent "${agent.slug}" requires function "${fnName}" but it was not found in functions/`,
        );
      }
    }
  }

  // Load components
  const components = await loadComponents(dir);

  // Load knowledge
  const knowledge = await loadKnowledge(dir);

  return { dir, packageName, agents, tasklists, functions, functionsBundled, nodeModulesDir, dependentSpaces, components, knowledge };
}
