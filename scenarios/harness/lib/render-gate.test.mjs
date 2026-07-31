/**
 * render-gate.test.mjs — the builder-agnostic adapter's pure half.
 *
 * The gate itself needs a browser; everything here does not. What is under test is the part that
 * decides WHICH url gets looked at, because that is where this harness has already shipped a bug
 * once: a global id pool handed `recipes/[id]` an INGREDIENT id, the page 404'd, and the gate blamed
 * the page (PROGRESS.md, Wave 2). The per-collection scoping below is the fix, so it is asserted in
 * both directions — it resolves the right id, and it refuses to invent a wrong one.
 */
import { describe, it, expect } from 'vitest';
import { collectionOf, matchTable, idOf, routesForGate, compactRenderGate } from './render-gate.mjs';

describe('collectionOf', () => {
  it('names the segment a route parameter hangs off', () => {
    expect(collectionOf('/plants/:id')).toBe('plants');
    expect(collectionOf('/appointments/:apptId/notes')).toBe('appointments');
  });
  it('is empty for a route with no parameter, and for a parameter with no parent', () => {
    expect(collectionOf('/')).toBe('');
    expect(collectionOf('/plants')).toBe('');
    expect(collectionOf('/:id')).toBe('');
  });
});

describe('matchTable', () => {
  it('matches exactly, and across the singular/plural split app authors use', () => {
    expect(matchTable('plants', ['plants', 'watering_events'])).toBe('plants');
    expect(matchTable('plants', ['plant'])).toBe('plant');
    expect(matchTable('plant', ['plants'])).toBe('plants');
    expect(matchTable('categories', ['category'])).toBe('category');
  });
  it('returns null rather than guessing when nothing corresponds', () => {
    expect(matchTable('invoices', ['plants', 'rooms'])).toBeNull();
    expect(matchTable('', ['plants'])).toBeNull();
  });
});

describe('idOf', () => {
  it('prefers an explicit id, then another key-shaped column', () => {
    expect(idOf({ id: 'abc', name: 'x' })).toBe('abc');
    expect(idOf({ slug: 'monstera', name: 'x' })).toBe('monstera');
    expect(idOf({ name: 'x', room: 'y' })).toBeNull();
  });
  it('never returns an empty value as an id', () => {
    expect(idOf({ id: '' })).toBeNull();
    expect(idOf({ id: null })).toBeNull();
    expect(idOf(null)).toBeNull();
  });
});

describe('routesForGate', () => {
  const buildRoutes = [
    { routePath: '/', file: 'pages/index.tsx' },
    { routePath: '/plants', file: 'pages/plants.tsx' },
    { routePath: '/plants/:id', file: 'pages/plants/[id].tsx' },
    { routePath: '/plants/new', file: 'pages/plants/new.tsx' },
  ];

  it('carries the authored file through, so a finding names the real artifact for either builder', () => {
    const routes = routesForGate(buildRoutes, {});
    expect(routes.map((r) => r.file)).toEqual(['pages/index.tsx', 'pages/plants.tsx', 'pages/plants/[id].tsx', 'pages/plants/new.tsx']);
  });

  it('fills a detail route from ITS OWN collection', () => {
    const routes = routesForGate(buildRoutes, {
      watering_events: [{ id: 'event-1' }],
      plants: [{ id: 'plant-1', name: 'Monstera' }],
    });
    const detail = routes.find((r) => r.route === '/plants/:id');
    expect(detail.params).toEqual({ id: 'plant-1' });
  });

  it('THE REGRESSION: never fills from another collection, even when it is the only one with rows', () => {
    // The shipped bug: `ingredients` was fetched first, so `recipes/[id]` was smoked with an
    // ingredient id. An unresolved parameter must stay unresolved.
    const routes = routesForGate(buildRoutes, { watering_events: [{ id: 'event-1' }] });
    const detail = routes.find((r) => r.route === '/plants/:id');
    expect(detail.params).toEqual({});
  });

  it('leaves a parameter unresolved when the owning table is empty', () => {
    const routes = routesForGate(buildRoutes, { plants: [] });
    expect(routes.find((r) => r.route === '/plants/:id').params).toEqual({});
  });

  it('does not guess at a multi-parameter route', () => {
    const routes = routesForGate([{ routePath: '/trips/:tripId/legs/:legId' }], { trips: [{ id: 't1' }] });
    expect(routes[0].params).toEqual({});
  });

  it('tolerates a missing/garbled build route table', () => {
    expect(routesForGate(null, {})).toEqual([]);
    expect(routesForGate([null, { file: 'x' }, { routePath: '/ok' }], {})).toEqual([{ route: '/ok', params: {} }]);
  });
});

describe('compactRenderGate', () => {
  it('preserves a null ok — an unavailable gate is never compacted into a pass', () => {
    expect(compactRenderGate({ unavailable: true, reason: 'no browser' })).toEqual({ ok: null, unavailable: true, reason: 'no browser' });
    expect(compactRenderGate(undefined)).toBeUndefined();
  });
  it('keeps the counts and caps the findings, listing the screenshots', () => {
    const out = compactRenderGate({
      ok: false,
      errorCount: 1,
      counts: { pages: 2, measured: 2, blank: 1 },
      findings: [{ code: 'empty-render', route: '/', viewport: 'phone', message: 'blank' }],
      pages: [{ screenshot: { path: '/tmp/a.png' } }, { screenshot: null }],
    });
    expect(out.ok).toBe(false);
    expect(out.counts.blank).toBe(1);
    expect(out.findings).toHaveLength(1);
    expect(out.screenshots).toEqual(['/tmp/a.png']);
  });
});
