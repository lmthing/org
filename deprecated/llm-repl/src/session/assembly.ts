/**
 * SessionAssembly manages a per-session git repo for context snapshots.
 * Each inspect() call commits 4 files: session.ts, scope.json, heap.bin, meta.json.
 */
import { execFile as _execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { marshalHeap } from './heap.js';
import type { MetaJson } from './types.js';

const execFile = promisify(_execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd });
  return stdout.trim();
}

export interface SessionCommitData {
  sessionTs: string;
  scopeJson: string;
  scope: Record<string, unknown>;
  meta: MetaJson;
}

export interface CommitResult {
  ref: string;
  sha: string;
  heapSkipped: boolean;
}

export class SessionAssembly {
  private readonly _sessionDir: string;
  private _inspectCount = 0;
  private _initialized = false;

  constructor(
    private readonly baseDir: string,
    private readonly sessionId: string,
  ) {
    this._sessionDir = join(baseDir, `session-${sessionId}`);
  }

  get sessionDir(): string {
    return this._sessionDir;
  }

  async init(): Promise<void> {
    if (this._initialized) return;
    await mkdir(this._sessionDir, { recursive: true });
    await git(this._sessionDir, ['init']);
    await git(this._sessionDir, ['config', 'user.email', 'session@llm-repl.local']);
    await git(this._sessionDir, ['config', 'user.name', 'llm-repl']);
    this._initialized = true;
  }

  async commit(data: SessionCommitData): Promise<CommitResult> {
    this._inspectCount += 1;
    const ref = `inspect-${this._inspectCount}`;

    const { buf: heapBuf, skipped: heapSkipped } = marshalHeap(data.scope);

    await Promise.all([
      writeFile(join(this._sessionDir, 'session.ts'), data.sessionTs, 'utf-8'),
      writeFile(join(this._sessionDir, 'scope.json'), data.scopeJson, 'utf-8'),
      writeFile(join(this._sessionDir, 'heap.bin'), heapBuf),
      writeFile(join(this._sessionDir, 'meta.json'), JSON.stringify(data.meta, null, 2), 'utf-8'),
    ]);

    await git(this._sessionDir, ['add', '-A']);
    await git(this._sessionDir, ['commit', '--allow-empty', '-m', ref]);
    await git(this._sessionDir, ['tag', ref]);

    const sha = await git(this._sessionDir, ['rev-parse', 'HEAD']);

    return { ref, sha, heapSkipped };
  }

  async checkpoint(label: string): Promise<void> {
    await git(this._sessionDir, ['tag', `cp-${label}`]);
  }

  async rollbackByLabel(label: string): Promise<void> {
    await git(this._sessionDir, ['reset', '--hard', `cp-${label}`]);
  }

  async rollbackBySha(sha: string): Promise<void> {
    await git(this._sessionDir, ['reset', '--hard', sha]);
  }

  async readSessionTs(): Promise<string> {
    return readFile(join(this._sessionDir, 'session.ts'), 'utf-8');
  }

  async readHeapBin(): Promise<Buffer | null> {
    try {
      return await readFile(join(this._sessionDir, 'heap.bin'));
    } catch {
      return null;
    }
  }

  async readMeta(): Promise<MetaJson | null> {
    try {
      const raw = await readFile(join(this._sessionDir, 'meta.json'), 'utf-8');
      return JSON.parse(raw) as MetaJson;
    } catch {
      return null;
    }
  }

  async getLog(): Promise<Array<{ sha: string; message: string }>> {
    const out = await git(this._sessionDir, ['log', '--format=%H %s']);
    if (!out) return [];
    return out.split('\n').map((line) => {
      const idx = line.indexOf(' ');
      return {
        sha: line.slice(0, idx),
        message: line.slice(idx + 1),
      };
    });
  }
}
