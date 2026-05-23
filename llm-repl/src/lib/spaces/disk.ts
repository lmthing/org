/**
 * Disk-template loader for spaces.
 *
 * Reads a directory laid out in the legacy space format:
 *
 *   <spaceDir>/
 *   ├── package.json          (optional)
 *   ├── README.md             (optional)
 *   ├── agents/<slug>/{config.json, instruct.md}
 *   ├── functions/*.{ts,tsx}
 *   ├── components/view/*.tsx
 *   ├── components/form/*.tsx
 *   ├── knowledge/<domain>/[config.json]
 *   │            └── <field>/[config.json]
 *   │                       └── <option>.md
 *   └── flows/<slug>/{index.md, 1.*.md, 2.*.md, …}
 *
 * Populates a {@link Space} via its public `add*` methods, then returns the
 * loaded {@link SpaceHandle}. Pure side-effect free w.r.t. the source dir —
 * it only reads.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { Space } from './space.js';
import type { SpaceHandle } from './space.js';
import type { TraceWriter } from '../sandbox/trace.js';

export interface LoadSpaceFromDiskOpts {
  /** Source directory containing the space template. */
  sourceDir: string;
  /** Session directory under which the runtime space tree lives. */
  sessionDir: string;
  /** Trace writer for emitted load events. */
  trace: TraceWriter;
  /** Override the space name (defaults to basename(sourceDir)). */
  name?: string;
}

export interface DiskAgent {
  slug: string;
  config: Record<string, unknown>;
  /** Raw instruct.md content (frontmatter + body). */
  instruct: string;
}

export interface DiskFlowStep {
  file: string;
  content: string;
}

export interface DiskFlow {
  slug: string;
  index?: string;
  steps: DiskFlowStep[];
}

export interface DiskKnowledgeOption {
  option: string;
  content: string;
}

export interface DiskKnowledgeField {
  field: string;
  config?: Record<string, unknown>;
  options: DiskKnowledgeOption[];
}

export interface DiskKnowledgeDomain {
  domain: string;
  config?: Record<string, unknown>;
  fields: DiskKnowledgeField[];
}

export interface LoadedDiskSpace {
  space: Space;
  handle: SpaceHandle;
  name: string;
  sourceDir: string;
  packageJson?: Record<string, unknown>;
  readme?: string;
  agents: DiskAgent[];
  functions: Array<{ name: string; source: string; ext: string }>;
  components: Array<{ name: string; kind: 'view' | 'form'; source: string }>;
  knowledge: DiskKnowledgeDomain[];
  flows: DiskFlow[];
}

async function safeRead(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf-8');
  } catch {
    return undefined;
  }
}

async function safeReadJson(path: string): Promise<Record<string, unknown> | undefined> {
  const raw = await safeRead(path);
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

async function safeReadDir(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

async function isDir(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function loadAgents(dir: string): Promise<DiskAgent[]> {
  const out: DiskAgent[] = [];
  const slugs = await safeReadDir(dir);
  for (const slug of slugs) {
    const slugDir = join(dir, slug);
    if (!(await isDir(slugDir))) continue;
    const config = (await safeReadJson(join(slugDir, 'config.json'))) ?? {};
    const instruct = (await safeRead(join(slugDir, 'instruct.md'))) ?? '';
    out.push({ slug, config, instruct });
  }
  return out;
}

async function loadFunctions(
  dir: string,
): Promise<Array<{ name: string; source: string; ext: string }>> {
  const out: Array<{ name: string; source: string; ext: string }> = [];
  for (const file of await safeReadDir(dir)) {
    const ext = extname(file);
    if (ext !== '.ts' && ext !== '.tsx') continue;
    const name = basename(file, ext);
    const source = (await safeRead(join(dir, file))) ?? '';
    out.push({ name, source, ext });
  }
  return out;
}

async function loadComponentsKind(
  dir: string,
  kind: 'view' | 'form',
): Promise<Array<{ name: string; kind: 'view' | 'form'; source: string }>> {
  const out: Array<{ name: string; kind: 'view' | 'form'; source: string }> = [];
  for (const file of await safeReadDir(dir)) {
    if (extname(file) !== '.tsx') continue;
    const name = basename(file, '.tsx');
    const source = (await safeRead(join(dir, file))) ?? '';
    out.push({ name, kind, source });
  }
  return out;
}

async function loadKnowledge(dir: string): Promise<DiskKnowledgeDomain[]> {
  const domains: DiskKnowledgeDomain[] = [];
  for (const domain of await safeReadDir(dir)) {
    const dDir = join(dir, domain);
    if (!(await isDir(dDir))) continue;
    const dConfig = await safeReadJson(join(dDir, 'config.json'));
    const fields: DiskKnowledgeField[] = [];
    for (const field of await safeReadDir(dDir)) {
      if (field === 'config.json') continue;
      const fDir = join(dDir, field);
      if (!(await isDir(fDir))) continue;
      const fConfig = await safeReadJson(join(fDir, 'config.json'));
      const options: DiskKnowledgeOption[] = [];
      for (const opt of await safeReadDir(fDir)) {
        if (opt === 'config.json' || extname(opt) !== '.md') continue;
        const content = (await safeRead(join(fDir, opt))) ?? '';
        options.push({ option: basename(opt, '.md'), content });
      }
      fields.push({ field, config: fConfig, options });
    }
    domains.push({ domain, config: dConfig, fields });
  }
  return domains;
}

async function loadFlows(dir: string): Promise<DiskFlow[]> {
  const out: DiskFlow[] = [];
  for (const slug of await safeReadDir(dir)) {
    const fDir = join(dir, slug);
    if (!(await isDir(fDir))) continue;
    const index = await safeRead(join(fDir, 'index.md'));
    const steps: DiskFlowStep[] = [];
    const files = await safeReadDir(fDir);
    // Step files start with a number, e.g. "1.Plan.md"
    const stepFiles = files
      .filter((f) => /^\d+\..+\.md$/.test(f))
      .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    for (const f of stepFiles) {
      const content = (await safeRead(join(fDir, f))) ?? '';
      steps.push({ file: f, content });
    }
    out.push({ slug, index, steps });
  }
  return out;
}

/**
 * Load a space template from disk and populate a Space instance.
 *
 * The Space is built fresh (not mutated in place) — repeated calls with the
 * same options yield equivalent results. Side effects: writes the loaded
 * template into the session's space dir via Space.add* methods so the
 * runtime sees the same on-disk shape as any session-authored space.
 */
export async function loadSpaceFromDisk(opts: LoadSpaceFromDiskOpts): Promise<LoadedDiskSpace> {
  const { sourceDir, sessionDir, trace } = opts;
  const name = opts.name ?? basename(sourceDir);

  trace.write({ type: 'space_disk_load_start', sourceDir, name });

  const packageJson = await safeReadJson(join(sourceDir, 'package.json'));
  const readme = await safeRead(join(sourceDir, 'README.md'));
  const agents = await loadAgents(join(sourceDir, 'agents'));
  const functions = await loadFunctions(join(sourceDir, 'functions'));
  const viewComps = await loadComponentsKind(join(sourceDir, 'components', 'view'), 'view');
  const formComps = await loadComponentsKind(join(sourceDir, 'components', 'form'), 'form');
  const components = [...viewComps, ...formComps];
  const knowledge = await loadKnowledge(join(sourceDir, 'knowledge'));
  const flows = await loadFlows(join(sourceDir, 'flows'));

  const space = new Space(name, { sessionDir, trace });

  for (const fn of functions) {
    space.addFunction(fn.name, fn.source);
  }
  for (const c of components) {
    if (c.kind === 'view') space.addViewComponent(c.name, c.source);
    else space.addFormComponent(c.name, c.source);
  }
  for (const a of agents) {
    space.addAgent(a.slug, { config: a.config, instruct: a.instruct });
  }
  for (const d of knowledge) {
    const fields: Record<string, unknown> = {};
    if (d.config) fields['__config'] = d.config;
    for (const f of d.fields) {
      const fObj: Record<string, unknown> = {};
      if (f.config) fObj['__config'] = f.config;
      for (const o of f.options) fObj[o.option] = o.content;
      fields[f.field] = fObj;
    }
    space.addKnowledgeDomain(d.domain, fields);
  }

  const handle = await space.load();

  trace.write({
    type: 'space_disk_load_done',
    name,
    sourceDir,
    counts: {
      agents: agents.length,
      functions: functions.length,
      components: components.length,
      knowledgeDomains: knowledge.length,
      flows: flows.length,
    },
  });

  return {
    space,
    handle,
    name,
    sourceDir,
    packageJson,
    readme,
    agents,
    functions,
    components,
    knowledge,
    flows,
  };
}
