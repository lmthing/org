/**
 * Space — Phase 11 (L10)
 *
 * Manages the session space file tree:
 *   session-{id}/space/
 *   ├── functions/      .ts files
 *   ├── components/
 *   │   ├── view/       .tsx files
 *   │   └── form/       .tsx files
 *   ├── agents/         .json files
 *   └── knowledge/      .json files
 */
import {
  mkdir,
  readFile as nodeReadFile,
  writeFile as nodeWriteFile,
  readdir,
  rm as nodeRm,
} from 'node:fs/promises';
import { join, dirname, basename, extname } from 'node:path';
import type { TraceWriter } from '../sandbox/trace.js';

export type SpaceComponentKind = 'view' | 'form';
export type SpaceEntryKind =
  | 'function'
  | 'class'
  | 'view_component'
  | 'form_component'
  | 'agent'
  | 'knowledge_domain';

export interface SpaceHandle {
  name: string;
  agents: Record<string, unknown>;
  functions: Record<string, unknown>;
  components: Record<string, unknown>;
  knowledge: Record<string, unknown>;
  /** Lazy load a function/class into .functions.{name} */
  loadFunction(name: string, opts?: { expand?: boolean }): void;
  /** Read a file in the space */
  read(path: string): Promise<string>;
  /** Write a file in the space */
  write(path: string, content: string): Promise<void>;
  /** Patch a file (find-and-replace) */
  patch(path: string, from: string, to: string): Promise<void>;
  /** List entries in a space directory */
  list(path?: string): Promise<string[]>;
  /** Remove a file */
  remove(path: string): Promise<void>;
}

/**
 * Marker placed on scope variables whose class has been deleted from the space.
 * processClassDeletion() scans the scope for these and nullifies them.
 */
export interface OrphanedClassVar {
  __orphaned: string;
}

export class Space {
  private readonly _name: string;
  private readonly _sessionDir: string;
  private readonly _trace: TraceWriter;
  private readonly _spaceDir: string;
  private _handle: SpaceHandle | null = null;

  constructor(
    name: string,
    opts: {
      sessionDir: string;
      trace: TraceWriter;
    },
  ) {
    this._name = name;
    this._sessionDir = opts.sessionDir;
    this._trace = opts.trace;
    this._spaceDir = join(opts.sessionDir, 'space');
  }

  /**
   * Create or get the current session Space.
   * The name is derived from the sessionDir basename.
   */
  static current(opts: { sessionDir: string; trace: TraceWriter }): Space {
    const name = basename(opts.sessionDir);
    return new Space(name, opts);
  }

  get name(): string {
    return this._name;
  }

  get handle(): SpaceHandle {
    if (!this._handle) {
      throw new Error('Space not loaded — call space.load() first');
    }
    return this._handle;
  }

  private async _ensureDir(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
  }

  private _absolutePath(relPath: string): string {
    return join(this._spaceDir, relPath);
  }

  /** Add a function to the space */
  addFunction(name: string, source: string): this {
    const filePath = join(this._spaceDir, 'functions', `${name}.ts`);
    this._ensureDir(dirname(filePath)).then(() => {
      nodeWriteFile(filePath, source, 'utf-8').then(() => {
        this._trace.write({ type: 'space_file_write', method: 'addFunction', path: filePath });
      });
    });
    return this;
  }

  /** Add a view component */
  addViewComponent(name: string, source: string): this {
    const filePath = join(this._spaceDir, 'components', 'view', `${name}.tsx`);
    this._ensureDir(dirname(filePath)).then(() => {
      nodeWriteFile(filePath, source, 'utf-8').then(() => {
        this._trace.write({ type: 'space_file_write', method: 'addViewComponent', path: filePath });
      });
    });
    return this;
  }

  /** Add a form component */
  addFormComponent(name: string, source: string): this {
    const filePath = join(this._spaceDir, 'components', 'form', `${name}.tsx`);
    this._ensureDir(dirname(filePath)).then(() => {
      nodeWriteFile(filePath, source, 'utf-8').then(() => {
        this._trace.write({ type: 'space_file_write', method: 'addFormComponent', path: filePath });
      });
    });
    return this;
  }

  /** Add an agent definition */
  addAgent(name: string, config: unknown): this {
    const filePath = join(this._spaceDir, 'agents', `${name}.json`);
    this._ensureDir(dirname(filePath)).then(() => {
      nodeWriteFile(filePath, JSON.stringify(config, null, 2), 'utf-8').then(() => {
        this._trace.write({ type: 'space_file_write', method: 'addAgent', path: filePath });
      });
    });
    return this;
  }

  /** Add a knowledge domain */
  addKnowledgeDomain(domain: string, fields: Record<string, unknown>): this {
    const filePath = join(this._spaceDir, 'knowledge', `${domain}.json`);
    this._ensureDir(dirname(filePath)).then(() => {
      nodeWriteFile(filePath, JSON.stringify(fields, null, 2), 'utf-8').then(() => {
        this._trace.write({ type: 'space_file_write', method: 'addKnowledgeDomain', path: filePath });
      });
    });
    return this;
  }

  /** Add a knowledge field to an existing domain */
  addKnowledgeField(domain: string, field: string, value: unknown): this {
    const filePath = join(this._spaceDir, 'knowledge', `${domain}.json`);
    this._ensureDir(dirname(filePath)).then(async () => {
      let existing: Record<string, unknown> = {};
      try {
        const raw = await nodeReadFile(filePath, 'utf-8');
        existing = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        // new domain
      }
      existing[field] = value;
      await nodeWriteFile(filePath, JSON.stringify(existing, null, 2), 'utf-8');
      this._trace.write({ type: 'space_file_write', method: 'addKnowledgeField', path: filePath, field });
    });
    return this;
  }

  /** Read a space file (relative to space root) */
  async read(path: string): Promise<string> {
    const abs = this._absolutePath(path);
    return nodeReadFile(abs, 'utf-8');
  }

  /** Write arbitrary file in space (relative to space root) */
  async write(path: string, content: string): Promise<void> {
    const abs = this._absolutePath(path);
    await this._ensureDir(dirname(abs));
    await nodeWriteFile(abs, content, 'utf-8');
    this._trace.write({ type: 'space_file_write', method: 'write', path: abs });
  }

  /** Patch a file (find-and-replace, relative to space root) */
  async patch(path: string, from: string, to: string): Promise<void> {
    const abs = this._absolutePath(path);
    const content = await nodeReadFile(abs, 'utf-8');
    const patched = content.split(from).join(to);
    await nodeWriteFile(abs, patched, 'utf-8');
    this._trace.write({ type: 'space_file_patch', method: 'patch', path: abs });
  }

  /** List entries in a space directory (relative to space root) */
  async list(path?: string): Promise<string[]> {
    const dir = path ? this._absolutePath(path) : this._spaceDir;
    try {
      return await readdir(dir);
    } catch {
      return [];
    }
  }

  /** Remove a file (relative to space root) */
  async remove(path: string): Promise<void> {
    const abs = this._absolutePath(path);
    await nodeRm(abs, { force: true });
    this._trace.write({ type: 'space_file_remove', method: 'remove', path: abs });
  }

  /**
   * Process class deletion cascade.
   * When a class is removed from the space, scope variables that are instances
   * (have __orphaned: 'ClassName') are nullified and a trace event is emitted per var.
   */
  processClassDeletion(className: string, scope: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(scope)) {
      if (
        value !== null &&
        typeof value === 'object' &&
        (value as Record<string, unknown>)['__orphaned'] === className
      ) {
        scope[key] = null;
        this._trace.write({ type: 'class_instance_nullified', className, variable: key });
      }
    }
  }

  /** Load the full SpaceHandle (lazy load all entries) */
  async load(): Promise<SpaceHandle> {
    await this._ensureDir(this._spaceDir);
    await Promise.all([
      this._ensureDir(join(this._spaceDir, 'functions')),
      this._ensureDir(join(this._spaceDir, 'components', 'view')),
      this._ensureDir(join(this._spaceDir, 'components', 'form')),
      this._ensureDir(join(this._spaceDir, 'agents')),
      this._ensureDir(join(this._spaceDir, 'knowledge')),
    ]);

    const loadedFunctions: Record<string, unknown> = {};
    const loadedComponents: Record<string, unknown> = {};
    const loadedAgents: Record<string, unknown> = {};
    const loadedKnowledge: Record<string, unknown> = {};

    // Load functions (stubs)
    try {
      const fnFiles = await readdir(join(this._spaceDir, 'functions'));
      for (const file of fnFiles) {
        if (file.endsWith('.ts')) {
          const name = basename(file, '.ts');
          loadedFunctions[name] = `/* collapsed — call loadFunction('${name}', { expand: true }) then inspect() */`;
        }
      }
    } catch {
      // empty
    }

    // Load components
    try {
      const viewFiles = await readdir(join(this._spaceDir, 'components', 'view'));
      for (const file of viewFiles) {
        if (file.endsWith('.tsx')) {
          const name = basename(file, '.tsx');
          loadedComponents[name] = { kind: 'view', stub: true };
        }
      }
    } catch {
      // empty
    }

    try {
      const formFiles = await readdir(join(this._spaceDir, 'components', 'form'));
      for (const file of formFiles) {
        if (file.endsWith('.tsx')) {
          const name = basename(file, '.tsx');
          loadedComponents[name] = { kind: 'form', stub: true };
        }
      }
    } catch {
      // empty
    }

    // Load agents
    try {
      const agentFiles = await readdir(join(this._spaceDir, 'agents'));
      for (const file of agentFiles) {
        if (file.endsWith('.json')) {
          const name = basename(file, '.json');
          try {
            const raw = await nodeReadFile(join(this._spaceDir, 'agents', file), 'utf-8');
            loadedAgents[name] = JSON.parse(raw) as unknown;
          } catch {
            loadedAgents[name] = null;
          }
        }
      }
    } catch {
      // empty
    }

    // Load knowledge
    try {
      const knowledgeFiles = await readdir(join(this._spaceDir, 'knowledge'));
      for (const file of knowledgeFiles) {
        if (file.endsWith('.json')) {
          const domain = basename(file, '.json');
          try {
            const raw = await nodeReadFile(join(this._spaceDir, 'knowledge', file), 'utf-8');
            loadedKnowledge[domain] = JSON.parse(raw) as unknown;
          } catch {
            loadedKnowledge[domain] = null;
          }
        }
      }
    } catch {
      // empty
    }

    const space = this;

    const handle: SpaceHandle = {
      name: this._name,
      agents: loadedAgents,
      functions: loadedFunctions,
      components: loadedComponents,
      knowledge: loadedKnowledge,

      loadFunction(name: string, opts?: { expand?: boolean }): void {
        if (opts?.expand) {
          handle.functions[name] = `/* expanded — inspect() to view full interface */`;
        } else {
          handle.functions[name] = `/* collapsed class — call loadFunction('${name}', { expand: true }) then inspect() */`;
        }
      },

      async read(path: string): Promise<string> {
        return space.read(path);
      },

      async write(path: string, content: string): Promise<void> {
        return space.write(path, content);
      },

      async patch(path: string, from: string, to: string): Promise<void> {
        return space.patch(path, from, to);
      },

      async list(path?: string): Promise<string[]> {
        return space.list(path);
      },

      async remove(path: string): Promise<void> {
        return space.remove(path);
      },
    };

    this._handle = handle;
    return handle;
  }

  /** Get .d.ts overlay for a space (for system prompt augmentation) */
  generateDtsOverlay(): string {
    const lines: string[] = [`// === Space: ${this._name} ===`];

    if (this._handle) {
      // Functions
      for (const [name, value] of Object.entries(this._handle.functions)) {
        if (typeof value === 'string' && value.includes('collapsed')) {
          lines.push(`declare function ${name}(...args: unknown[]): unknown; // collapsed`);
        } else {
          lines.push(`declare function ${name}(...args: unknown[]): unknown;`);
        }
      }

      // Components
      for (const [name, value] of Object.entries(this._handle.components)) {
        const kind = (value as Record<string, unknown>)?.['kind'] ?? 'view';
        if (kind === 'form') {
          lines.push(`declare const ${name}: React.FC<{ submit?: (data: unknown) => void }>;`);
        } else {
          lines.push(`declare const ${name}: React.FC<Record<string, unknown>>;`);
        }
      }

      // Agents
      for (const name of Object.keys(this._handle.agents)) {
        lines.push(`declare const ${name}: AgentHandle;`);
      }

      // Knowledge
      for (const domain of Object.keys(this._handle.knowledge)) {
        lines.push(`declare const ${domain}: KnowledgeDomain;`);
      }
    }

    return lines.join('\n');
  }
}

/**
 * Load a space by reading .ts/.tsx files from the space directory
 * and building declarations for the DTS overlay.
 */
export function buildDtsFromFiles(
  spaceDir: string,
  files: Array<{ path: string; content: string }>,
): string {
  const lines: string[] = [];

  for (const file of files) {
    const ext = extname(file.path);
    const name = basename(file.path, ext);

    if (ext === '.ts') {
      // Extract function/class name using simple regex
      const fnMatch = /(function|const)\s+(\w+)/.exec(file.content);
      const extractedName = fnMatch?.[2] ?? name;
      lines.push(`declare function ${extractedName}(...args: unknown[]): unknown;`);
    } else if (ext === '.tsx') {
      // Component: check if it has a submit prop (form component)
      const isForm = /submit\s*[?:]/.test(file.content);
      if (isForm) {
        lines.push(`declare const ${name}: React.FC<{ submit?: (data: unknown) => void }>;`);
      } else {
        lines.push(`declare const ${name}: React.FC<Record<string, unknown>>;`);
      }
    }
  }

  return lines.join('\n');
}
