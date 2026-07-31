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
    // The team ids are KNOWN on every pod — a space file declaring one must load
    // on a personal pod too (the GRANT is what gets dropped there, see team.test.ts).
    expect(CAPABILITY_IDS.has('team:read')).toBe(true);
    expect(CAPABILITY_IDS.has('team:post')).toBe(true);
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
    // user-memory/memory (db:write ceiling for its migrate_to_app_db action), and
    // system-desktop-browser/devtools (browser:cdp — raw DevTools Protocol against the desktop's
    // browser, the narrowest grant in the system). Every other system agent parses to {}.
    // Asserted PER AGENT rather than per space. A space is not uniformly capability-bearing:
    // `system-desktop-browser` ships `devtools`, which holds `browser:cdp`, alongside `browse`,
    // which holds nothing because its own function list is its gate. Grouping by directory made
    // the second one look like a mistake.
    const holders = spaces
      .flatMap((space) =>
        Object.entries(space.agents).map(([name, agent]) => ({
          ref: `${space.dir.split('/').pop()}/${name}`,
          caps: Object.keys(agent.capabilities ?? {}),
        })),
      )
      .filter((a) => a.caps.length > 0)
      .map((a) => a.ref)
      .sort();
    expect(holders).toEqual([
      'system-appbuilder/api-author',
      'system-appbuilder/automator',
      'system-appbuilder/data-modeler',
      'system-appbuilder/page-builder',
      'system-desktop-browser/devtools',
      'system-engineer/engineer',
      'system-store/finder',
      'system-viewbuilder/api-author',
      'system-viewbuilder/automator',
      'system-viewbuilder/data-modeler',
      'system-viewbuilder/spec-builder',
      'user-memory/memory',
      'user-thing/thing',
    ]);
  });

  it("system-appbuilder's automator holds the full authoring capability set", async () => {
    const dirs = defaultSystemSpaceDirs();
    const spaces = await loadSystemSpaces(dirs);
    const appbuilder = spaces.find((s) => s.dir.endsWith('system-appbuilder'));
    expect(appbuilder, 'system-appbuilder loads').toBeTruthy();
    // app-architect (and the store-catalog build_app/publish_app pipeline) is gone — the
    // automator is now the sole builder agent, defaultAction build_live_project, and holds
    // the full live-project authoring set (project:manage moved to THING, not the builder).
    const automator = appbuilder!.agents['automator'];
    expect(automator, 'automator agent present').toBeTruthy();
    expect(automator!.capabilities).toEqual({
      'hooks:write': true,
      'db:schema': {},
      'db:read': {},
      'db:write': {},
      'pages:write': true,
      'api:write': true,
    });
  });

  /**
   * The `system-viewbuilder` guarantee is enforced by capability ABSENCE, not by prose. Its whole
   * premise is that the UI is 100% spec — which is what lets the same app render natively in the
   * mobile app with no WebView — and the mechanism is that no agent in that space holds
   * `pages:write`. Not granted ⇒ `writeProjectPage`/`writeProjectComponent` are neither injected nor
   * in the DTS, so an attempt to author freehand TSX is a typecheck error the model can see and
   * retry, rather than a rule it is asked to respect. A well-meaning "just add pages:write so it can
   * also write a component" would silently dissolve that, and nothing else in the repo would notice.
   */
  it('every system-viewbuilder agent holds views:write and NEVER pages:write', async () => {
    const dirs = defaultSystemSpaceDirs();
    const spaces = await loadSystemSpaces(dirs);
    const viewbuilder = spaces.find((s) => s.dir.endsWith('system-viewbuilder'));
    expect(viewbuilder, 'system-viewbuilder loads').toBeTruthy();

    for (const [slug, agent] of Object.entries(viewbuilder!.agents)) {
      expect(agent.capabilities?.['pages:write'], `${slug} must not hold pages:write`).toBeUndefined();
    }

    const automator = viewbuilder!.agents['automator'];
    expect(automator, 'automator agent present').toBeTruthy();
    expect(automator!.capabilities).toEqual({
      'hooks:write': true,
      'db:schema': {},
      'db:read': {},
      'db:write': {},
      'api:write': true,
      'views:write': true,
    });

    // The spec-builder is the narrow specialist: it authors views and reads data, nothing else.
    const specBuilder = viewbuilder!.agents['spec-builder'];
    expect(specBuilder, 'spec-builder agent present').toBeTruthy();
    expect(specBuilder!.capabilities).toEqual({ 'views:write': true, 'db:read': {} });
  });
});
