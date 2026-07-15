import { describe, it, expect } from 'vitest';
import { parseCapabilities, CAPABILITY_IDS, type AppCapabilities } from './capabilities.js';
import { loadSystemSpaces, defaultSystemSpaceDirs } from './system.js';

const ctx = (knownTables?: string[]) => ({ agentId: 'curator', knownTables });

describe('parseCapabilities', () => {
  it('returns an empty model when the key is absent (undefined/null)', () => {
    expect(parseCapabilities(undefined, ctx())).toEqual({});
    expect(parseCapabilities(null, ctx())).toEqual({});
  });

  it('parses a valid mixed list (bare + config-bearing) into AppCapabilities', () => {
    const raw = [
      { 'db:read': { tables: ['sources', 'raw_items'] } },
      { 'db:write': { tables: ['raw_items'] } },
      'db:schema', // bare db = all tables
      'pages:write', // bare authoring
      { 'api:call': { allow: ['webSearch', 'markRead'] } },
      { 'connections:use': { providers: ['google', 'slack'] } },
    ];
    const parsed = parseCapabilities(raw, ctx(['sources', 'raw_items']));
    const expected: AppCapabilities = {
      'db:read': { tables: ['sources', 'raw_items'] },
      'db:write': { tables: ['raw_items'] },
      'db:schema': {},
      'pages:write': true,
      'api:call': { allow: ['webSearch', 'markRead'] },
      'connections:use': { providers: ['google', 'slack'] },
    };
    expect(parsed).toEqual(expected);
  });

  it('exposes the known capability ids', () => {
    expect(CAPABILITY_IDS.has('db:read')).toBe(true);
    expect(CAPABILITY_IDS.has('api:call')).toBe(true);
    expect(CAPABILITY_IDS.has('connections:use')).toBe(true);
    expect(CAPABILITY_IDS.has('hooks:write')).toBe(true);
  });

  it('throws on an unknown capability id', () => {
    expect(() => parseCapabilities(['db:destroy'], ctx())).toThrow(/unknown capability "db:destroy"/);
  });

  it('throws on a config-bearing entry whose config has an unknown key', () => {
    expect(() => parseCapabilities([{ 'db:read': { columns: ['x'] } }], ctx())).toThrow(
      /disallowed config key\(s\): columns/,
    );
  });

  it('throws on a bare api:call (allow is required — no calling anything)', () => {
    expect(() => parseCapabilities(['api:call'], ctx())).toThrow(
      /"api:call" requires a config with an "allow" list/,
    );
  });

  it('throws on api:call with an empty allow list', () => {
    expect(() => parseCapabilities([{ 'api:call': { allow: [] } }], ctx())).toThrow(
      /requires a non-empty "allow" list/,
    );
  });

  it('throws on a bare connections:use (providers is required)', () => {
    expect(() => parseCapabilities(['connections:use'], ctx())).toThrow(
      /"connections:use" requires a config with a "providers" list/,
    );
  });

  it('throws on connections:use with an empty providers list', () => {
    expect(() => parseCapabilities([{ 'connections:use': { providers: [] } }], ctx())).toThrow(
      /requires a non-empty "providers" list/,
    );
  });

  it('throws on connections:use with an unknown config key', () => {
    expect(() =>
      parseCapabilities([{ 'connections:use': { services: ['google'] } }], ctx()),
    ).toThrow(/disallowed config key\(s\): services/);
  });

  it('throws when a bare-only authoring cap is given a config', () => {
    expect(() => parseCapabilities([{ 'pages:write': { route: '/x' } }], ctx())).toThrow(
      /"pages:write" takes no config/,
    );
  });

  it('parses bare knowledge:write as own-space only ({})', () => {
    expect(parseCapabilities(['knowledge:write'], ctx())).toEqual({ 'knowledge:write': {} });
  });

  it('parses knowledge:write with a spaces allow-list', () => {
    expect(parseCapabilities([{ 'knowledge:write': { spaces: ['other-space'] } }], ctx())).toEqual({
      'knowledge:write': { spaces: ['other-space'] },
    });
  });

  it('throws on knowledge:write with an unknown config key', () => {
    expect(() => parseCapabilities([{ 'knowledge:write': { dirs: ['x'] } }], ctx())).toThrow(
      /disallowed config key\(s\): dirs/,
    );
  });

  it('exposes knowledge:write as a known capability id', () => {
    expect(CAPABILITY_IDS.has('knowledge:write')).toBe(true);
  });

  it('throws when db:* names a non-existent table AND knownTables is supplied', () => {
    expect(() =>
      parseCapabilities([{ 'db:read': { tables: ['ghost'] } }], ctx(['sources'])),
    ).toThrow(/names table\(s\) not in the project's database\/: ghost/);
  });

  it('DEFERS the table check (no throw) when knownTables is undefined', () => {
    const parsed = parseCapabilities([{ 'db:read': { tables: ['ghost'] } }], ctx(undefined));
    expect(parsed).toEqual({ 'db:read': { tables: ['ghost'] } });
  });

  it('throws when capabilities is not a list', () => {
    expect(() => parseCapabilities({ 'db:read': true }, ctx())).toThrow(/must be a list/);
  });

  it('throws when a map entry has more than one key', () => {
    expect(() =>
      parseCapabilities([{ 'db:read': {}, 'db:write': {} }], ctx()),
    ).toThrow(/single-key map/);
  });

  it('throws when the same capability is declared twice', () => {
    expect(() => parseCapabilities(['pages:write', 'pages:write'], ctx())).toThrow(
      /more than once/,
    );
  });
});

describe('system-space smoke: the new frontmatter allow-list gate breaks nothing', () => {
  it('loads every real system space without throwing', async () => {
    const dirs = defaultSystemSpaceDirs();
    expect(dirs.length).toBeGreaterThan(0);
    const spaces = await loadSystemSpaces(dirs);
    expect(spaces.length).toBe(dirs.length);
    // System agents that declare capabilities: system-appbuilder's agents (project +
    // authoring grants), the integration-* spaces (connections:use), system-engineer/engineer
    // (fs:scratch → its scratch sandbox), system-store/finder (store:read),
    // user-thing/thing (db:read+db:write+store:install+api:call — the routing rebuild), and
    // user-memory/memory (db:write ceiling for its migrate_to_app_db action). Every other
    // system agent parses to {}.
    const capBearing = (dir: string): boolean =>
      dir.endsWith('system-appbuilder') ||
      dir.includes('integration-') ||
      dir.endsWith('system-engineer') ||
      dir.endsWith('system-store') ||
      dir.endsWith('user-thing') ||
      dir.endsWith('user-memory');
    for (const space of spaces) {
      const hasCaps = capBearing(space.dir);
      for (const agent of Object.values(space.agents)) {
        if (hasCaps) {
          expect(Object.keys(agent.capabilities ?? {}).length).toBeGreaterThan(0);
        } else {
          expect(agent.capabilities).toEqual({});
        }
      }
    }
  });

  it("system-appbuilder's app-architect holds the full authoring capability set", async () => {
    const dirs = defaultSystemSpaceDirs();
    const spaces = await loadSystemSpaces(dirs);
    const appbuilder = spaces.find((s) => s.dir.endsWith('system-appbuilder'));
    expect(appbuilder, 'system-appbuilder loads').toBeTruthy();
    const architect = appbuilder!.agents['app-architect'];
    expect(architect, 'app-architect agent present').toBeTruthy();
    expect(architect!.capabilities).toEqual({
      'project:manage': true,
      'db:schema': {},
      'db:read': {},
      'pages:write': true,
      'api:write': true,
      'hooks:write': true,
    });
  });
});
