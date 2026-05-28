import { readFile, readdir, stat } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { parseFrontmatter } from './frontmatter.js';

export interface Space {
  dir: string;
  agents: Record<string, AgentDef>;
  tasklists: Record<string, TasklistDir>; // slug -> sorted md files
  functions: Record<string, string>; // name -> source
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

async function loadFunctions(dir: string): Promise<Record<string, string>> {
  const functionsDir = join(dir, 'functions');
  if (!(await dirExists(functionsDir))) return {};

  const files = await listDir(functionsDir);
  const result: Record<string, string> = {};

  for (const file of files) {
    if (file.endsWith('.ts') || file.endsWith('.tsx')) {
      const name = basename(file, extname(file));
      const source = await readFile(join(functionsDir, file), 'utf8');
      result[name] = source;
    }
  }

  return result;
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

export async function loadSpace(dir: string): Promise<Space> {
  const agentsDir = join(dir, 'agents');

  if (!(await dirExists(agentsDir))) {
    throw new Error(`Space at "${dir}" must have an agents/ directory`);
  }

  const agentSlugs = await listDir(agentsDir);
  const agentDirs = [];
  for (const slug of agentSlugs) {
    if (await dirExists(join(agentsDir, slug))) {
      agentDirs.push(slug);
    }
  }

  if (agentDirs.length === 0) {
    throw new Error(`Space at "${dir}" must have at least one agent`);
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

  // Load functions
  const functions = await loadFunctions(dir);

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

  return { dir, agents, tasklists, functions, components, knowledge };
}
