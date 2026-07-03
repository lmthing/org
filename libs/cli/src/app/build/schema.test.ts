/**
 * {@link generateRowTypes} / {@link generateEndpointContracts} /
 * {@link generateAppTypes} — the 4A half of the typed-contract build.
 *
 * Filesystem + `ts-json-schema-generator` only; no db engine, no model turn loop.
 * Fixtures are tiny: a `feed_items` + `comments` pair (columns of every kind,
 * plus typed relations) and one `api/mark-read/POST.ts` handler.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  generateRowTypes,
  generateEndpointContracts,
  generateAppTypes,
  tableInterfaceName,
  escapeGlobPath,
} from './schema.js';
import { loadApiRoutes } from '../api/loader.js';
import type { LoadedTable } from '@lmthing/core';

const tmpDirs: string[] = [];
async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lm-schema-'));
  tmpDirs.push(dir);
  return dir;
}
afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

const FEED_ITEMS: LoadedTable = {
  name: 'feed_items',
  schema: {
    title: 'Feed items',
    description: 'One personalized item in the feed.',
    columns: {
      id: { type: 'string', description: 'unique id', primaryKey: true, generated: 'uuid' },
      title: { type: 'string', description: 'headline shown in the feed', required: true },
      score: { type: 'number', description: 'relevance rank', default: 0 },
      tags: { type: 'json', description: 'array of topic tag strings' },
      read: { type: 'boolean', description: 'whether the user has opened it', default: false },
      createdAt: { type: 'date', description: 'when the item entered the feed', generated: 'now' },
    },
    relations: {
      comments: { hasMany: 'comments', via: 'feedItemId', description: 'notes the user attached' },
    },
  },
};

const COMMENTS: LoadedTable = {
  name: 'comments',
  schema: {
    title: 'Comments',
    description: 'A note the user attached to a feed item.',
    columns: {
      id: { type: 'string', description: 'unique id', primaryKey: true, generated: 'uuid' },
      feedItemId: { type: 'string', description: 'the feed item this belongs to', required: true },
      body: { type: 'string', description: 'the comment text', required: true },
    },
    relations: {
      item: { belongsTo: 'feed_items', via: 'feedItemId', description: 'the item commented on' },
    },
  },
};

const MARK_READ_HANDLER = `
/** Mark a feed item as read. */
export const name = 'markRead'
export const description = 'Mark a single feed item read, by its id.'

export interface Input { /** feed item id */ id: string }
export interface Output { ok: boolean }

export default async function handler(input: Input): Promise<Output> {
  return { ok: Boolean(input.id) }
}
`;

describe('tableInterfaceName', () => {
  it('PascalCases and singularizes the last word deterministically', () => {
    expect(tableInterfaceName('feed_items')).toBe('FeedItem');
    expect(tableInterfaceName('comments')).toBe('Comment');
    expect(tableInterfaceName('categories')).toBe('Category');
    expect(tableInterfaceName('feed-status')).toBe('FeedStatus');
  });
});

describe('generateRowTypes', () => {
  const dts = generateRowTypes([FEED_ITEMS, COMMENTS]);

  it('emits an interface per table, correctly named', () => {
    expect(dts).toContain('export interface FeedItem {');
    expect(dts).toContain('export interface Comment {');
  });

  it('maps column kinds (bool/date/json) and required/optional flags', () => {
    // PK + required are non-optional; others optional. date → string, json → unknown.
    expect(dts).toContain('id: string;');
    expect(dts).toContain('title: string;');
    expect(dts).toContain('score?: number;');
    expect(dts).toContain('tags?: unknown;'); // json → unknown
    expect(dts).toContain('read?: boolean;'); // boolean
    expect(dts).toContain('createdAt?: string;'); // date → ISO string
    // no accidental non-optional on an unflagged column
    expect(dts).not.toContain('score: number;');
  });

  it('JSDocs each field from its description', () => {
    expect(dts).toContain('/** headline shown in the feed */');
    expect(dts).toContain('/** whether the user has opened it */');
    expect(dts).toContain('/** One personalized item in the feed. */');
  });

  it('emits typed relation fields (hasMany → Target[], belongsTo → Target), both optional', () => {
    expect(dts).toContain('comments?: Comment[];');
    expect(dts).toContain('item?: FeedItem;');
    expect(dts).toContain('/** notes the user attached */');
  });

  it('is deterministic (tables sorted by name)', () => {
    expect(dts).toBe(generateRowTypes([COMMENTS, FEED_ITEMS]));
    // comments sorts before feed_items
    expect(dts.indexOf('interface Comment')).toBeLessThan(dts.indexOf('interface FeedItem'));
  });
});

describe('generateEndpointContracts', () => {
  it('emits JSON Schema + compact TS type for Input/Output, keyed by name', async () => {
    const root = await scratch();
    await mkdir(join(root, 'api', 'mark-read'), { recursive: true });
    await writeFile(join(root, 'api', 'mark-read', 'POST.ts'), MARK_READ_HANDLER, 'utf8');

    const routes = await loadApiRoutes(root);
    const contracts = await generateEndpointContracts(root, routes.endpoints);

    expect(contracts).toHaveLength(1);
    const c = contracts[0];
    expect(c.name).toBe('markRead');
    expect(c.method).toBe('POST');
    expect(c.routePath).toBe('/mark-read');
    expect(c.description).toBe('Mark a single feed item read, by its id.');

    // Input schema requires id:string
    expect(c.inputSchema).toMatchObject({
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    });
    // Output schema has ok:boolean
    expect(c.outputSchema).toMatchObject({
      type: 'object',
      properties: { ok: { type: 'boolean' } },
    });

    // Compact TS-type strings for the apiCall overload 4B builds
    expect(c.inputTsType).toBe('{ id: string }');
    expect(c.outputTsType).toBe('{ ok: boolean }');
  });

  it('gives an empty-object input schema to a handler with no Input', async () => {
    const root = await scratch();
    await mkdir(join(root, 'api', 'ping'), { recursive: true });
    await writeFile(
      join(root, 'api', 'ping', 'GET.ts'),
      `export const name = 'ping'\nexport interface Output { pong: boolean }\nexport default async function handler() { return { pong: true } }\n`,
      'utf8',
    );

    const routes = await loadApiRoutes(root);
    const [c] = await generateEndpointContracts(root, routes.endpoints);
    expect(c.name).toBe('ping');
    expect(c.inputSchema).toEqual({ type: 'object', properties: {}, additionalProperties: false });
    expect(c.inputTsType).toBe('{}');
    expect(c.outputTsType).toBe('{ pong: boolean }');
  });

  // Regression: a handler in a **dynamic** route dir (`[id]`) must generate its
  // contract. The generator globs `config.path`; an unescaped `[id]` is a glob
  // character-class that matches no file → "No input files" and the whole build
  // dies. `escapeGlobPath` must neutralise the brackets. (Every project app with
  // a `[param]` route — e.g. `blog`'s `api/articles/[id]/GET.ts` — depends on this.)
  it('generates a contract for a dynamic [id] route dir (glob-escaped path)', async () => {
    const root = await scratch();
    await mkdir(join(root, 'api', 'articles', '[id]'), { recursive: true });
    await writeFile(
      join(root, 'api', 'articles', '[id]', 'GET.ts'),
      `export const name = 'getArticle'\nexport interface Input { id: string }\nexport interface Output { id: string; title: string }\nexport default async function handler(input: Input) { return { id: input.id, title: 't' } }\n`,
      'utf8',
    );

    const routes = await loadApiRoutes(root);
    const [c] = await generateEndpointContracts(root, routes.endpoints);
    expect(c.name).toBe('getArticle');
    expect(c.routePath).toBe('/articles/:id');
    expect(c.inputTsType).toBe('{ id: string }');
    expect(c.outputTsType).toBe('{ id: string; title: string }');
  });
});

describe('escapeGlobPath', () => {
  it('bracket-wraps glob metacharacters so a literal path stays literal', () => {
    expect(escapeGlobPath('/a/[id]/GET.ts')).toBe('/a/[[]id[]]/GET.ts');
    expect(escapeGlobPath('/plain/path.ts')).toBe('/plain/path.ts');
  });
});

describe('generateAppTypes', () => {
  it('writes types/generated.d.ts and returns endpoints', async () => {
    const root = await scratch();
    // database
    await mkdir(join(root, 'database'), { recursive: true });
    await writeFile(join(root, 'database', 'feed_items.json'), JSON.stringify(FEED_ITEMS.schema), 'utf8');
    await writeFile(join(root, 'database', 'comments.json'), JSON.stringify(COMMENTS.schema), 'utf8');
    // api
    await mkdir(join(root, 'api', 'mark-read'), { recursive: true });
    await writeFile(join(root, 'api', 'mark-read', 'POST.ts'), MARK_READ_HANDLER, 'utf8');

    const { generatedDts, endpoints } = await generateAppTypes(root);

    // returned dts matches what was written
    const onDisk = await readFile(join(root, 'types', 'generated.d.ts'), 'utf8');
    expect(onDisk).toBe(generatedDts);

    // row interfaces present
    expect(generatedDts).toContain('export interface FeedItem {');
    expect(generatedDts).toContain('comments?: Comment[];');
    // endpoint I/O interfaces present
    expect(generatedDts).toContain('export interface MarkReadInput { id: string }');
    expect(generatedDts).toContain('export interface MarkReadOutput { ok: boolean }');

    expect(endpoints).toHaveLength(1);
    expect(endpoints[0].name).toBe('markRead');
  });
});
