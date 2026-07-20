import { describe, it, expect } from 'vitest';

import type { LoadedTable, TableSchema } from './schema.js';
import { validateSchemaSet, validateTableSchema } from './validate.js';

/** The spec's canonical feed_items table. */
function feedItems(): TableSchema {
  return {
    title: 'Feed items',
    description: "One personalized item in the user's feed.",
    columns: {
      id: { type: 'string', description: 'unique id', primaryKey: true, generated: 'uuid' },
      title: { type: 'string', description: 'headline shown in the feed', required: true },
      url: { type: 'string', description: 'canonical source URL', required: true, unique: true },
      score: { type: 'number', description: 'relevance rank', default: 0 },
      tags: { type: 'json', description: 'array of topic tag strings' },
      read: { type: 'boolean', description: 'whether the user has opened it', default: false },
      createdAt: { type: 'date', description: 'when the item entered the feed', generated: 'now' },
    },
    relations: {
      comments: { hasMany: 'comments', via: 'feedItemId', description: 'notes the user attached' },
    },
  };
}

/** The spec's canonical comments table (many side, with FK). */
function comments(): TableSchema {
  return {
    title: 'Comments',
    description: 'A note the user attached to a feed item.',
    columns: {
      id: { type: 'string', description: 'unique id', primaryKey: true, generated: 'uuid' },
      feedItemId: {
        type: 'string',
        description: 'the feed item this comment belongs to',
        required: true,
        references: { table: 'feed_items', column: 'id', onDelete: 'cascade' },
      },
      body: { type: 'string', description: 'the comment text', required: true },
      createdAt: { type: 'date', description: 'when the note was written', generated: 'now' },
    },
    relations: {
      item: { belongsTo: 'feed_items', via: 'feedItemId', description: 'the item being commented on' },
    },
  };
}

function set(): LoadedTable[] {
  return [
    { name: 'feed_items', schema: feedItems() },
    { name: 'comments', schema: comments() },
  ];
}

describe('validateSchemaSet — valid', () => {
  it('accepts the spec two-table schema', () => {
    expect(() => validateSchemaSet(set())).not.toThrow();
  });
});

describe('validateTableSchema — per-table failures', () => {
  it('throws on missing table description', () => {
    const t = feedItems();
    (t as { description?: string }).description = '';
    expect(() => validateTableSchema('feed_items', t)).toThrow(/feed_items: table is missing required "description"/);
  });

  it('throws on missing column description', () => {
    const t = feedItems();
    (t.columns.url as { description?: string }).description = '';
    expect(() => validateTableSchema('feed_items', t)).toThrow(/feed_items\.url: column is missing required "description"/);
  });

  it('throws on missing relation description', () => {
    const t = feedItems();
    (t.relations!.comments as { description?: string }).description = '';
    expect(() => validateTableSchema('feed_items', t)).toThrow(/feed_items\.comments: relation is missing required "description"/);
  });

  it('throws on zero primary keys', () => {
    const t = feedItems();
    delete (t.columns.id as { primaryKey?: boolean }).primaryKey;
    expect(() => validateTableSchema('feed_items', t)).toThrow(/exactly one primaryKey column \(found 0\)/);
  });

  it('throws on two primary keys', () => {
    const t = feedItems();
    t.columns.url.primaryKey = true;
    expect(() => validateTableSchema('feed_items', t)).toThrow(/exactly one primaryKey column \(found 2\)/);
  });

  it('throws on a bad column type', () => {
    const t = feedItems();
    (t.columns.score as { type: string }).type = 'integer';
    expect(() => validateTableSchema('feed_items', t)).toThrow(/feed_items\.score: unknown column type "integer"/);
  });

  // A column `type` is exactly one of string/number/boolean/date/json — nullability is expressed
  // via `required`, never a TS union or array in `type`. `04-plan_tables.md` used to teach the
  // union/array shape, which throws here and silently fails the whole table's write.
  it('throws on a TS union column type ("string | null")', () => {
    const t = feedItems();
    (t.columns.score as { type: string }).type = 'string | null';
    expect(() => validateTableSchema('feed_items', t)).toThrow(/feed_items\.score: unknown column type "string \| null"/);
  });

  it('throws on an array-shape column type ("string[]")', () => {
    const t = feedItems();
    (t.columns.tags as { type: string }).type = 'string[]';
    expect(() => validateTableSchema('feed_items', t)).toThrow(/feed_items\.tags: unknown column type "string\[\]"/);
  });

  it('accepts every base type, with nullability expressed via `required` instead', () => {
    const t = feedItems();
    // `feedItems()` already exercises string/number/boolean/date/json across its columns, and
    // `score`/`tags` are optional (no `required`) — i.e. nullable via the flag, not the type.
    expect(() => validateTableSchema('feed_items', t)).not.toThrow();
    expect(t.columns.score!.required).toBeUndefined();
    expect(t.columns.tags!.type).toBe('json');
  });

  it('throws on a bad generated kind', () => {
    const t = feedItems();
    (t.columns.id as { generated?: string }).generated = 'serial';
    expect(() => validateTableSchema('feed_items', t)).toThrow(/unknown "generated" kind "serial"/);
  });
});

describe('validateSchemaSet — cross-table failures', () => {
  it('throws on a reference to a non-existent table', () => {
    const s = set();
    s[1]!.schema.columns.feedItemId!.references = { table: 'ghost', column: 'id' };
    expect(() => validateSchemaSet(s)).toThrow(/comments\.feedItemId: references unknown table "ghost"/);
  });

  it('throws on a reference to a non-existent column', () => {
    const s = set();
    s[1]!.schema.columns.feedItemId!.references = { table: 'feed_items', column: 'nope' };
    expect(() => validateSchemaSet(s)).toThrow(/comments\.feedItemId: references unknown column "feed_items\.nope"/);
  });

  it('throws on a relation targeting a missing table', () => {
    const s = set();
    (s[0]!.schema.relations!.comments as { hasMany: string }).hasMany = 'ghosts';
    expect(() => validateSchemaSet(s)).toThrow(/feed_items\.comments: relation targets unknown table "ghosts"/);
  });

  it('throws on a relation whose via column is missing', () => {
    const s = set();
    (s[0]!.schema.relations!.comments as { via: string }).via = 'noSuchColumn';
    expect(() => validateSchemaSet(s)).toThrow(/feed_items\.comments: relation "via" column "comments\.noSuchColumn" does not exist/);
  });
});
