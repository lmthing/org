/**
 * ab-pair.test.mjs — the A/B pairs really are pairs.
 *
 * The whole ladder (30/31/32) answers "same brief, which builder produces the better app?". If the
 * two briefs drift by so much as a sentence, every number downstream is measuring the drift instead.
 * Nothing about a drifted pair looks wrong — both files parse, both run, both produce metrics — so
 * this is asserted rather than eyeballed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AB_PAIRS, SCENARIOS, VIEW_AGENT, APP_AGENT, toAppbuilder, diffPair, assertOnlyBuilderDiffers } from './ab-pair.mjs';

describe('toAppbuilder', () => {
  it('rewrites the builder target and the id suffix', () => {
    const src = ['id: 30-x-view', 'steps:', `  - space_session: ${VIEW_AGENT}`, '    say: hello'].join('\n');
    const out = toAppbuilder(src);
    expect(out).toContain('id: 30-x-app');
    expect(out).toContain(`space_session: ${APP_AGENT}`);
    expect(out).not.toContain(VIEW_AGENT);
  });

  it('leaves the BRIEF alone — a broad find/replace would mangle the prose that explains the pair', () => {
    const src = ['id: 30-x-view', '# the viewbuilder is the thing under test here', 'steps:', `  - space_session: ${VIEW_AGENT}`].join('\n');
    const out = toAppbuilder(src);
    expect(out).toContain('# the viewbuilder is the thing under test here');
  });

  it('rewrites EVERY space_session, not just the first — a multi-build scenario has several', () => {
    const src = ['id: x-view', `  - space_session: ${VIEW_AGENT}`, '    say: a', `  - space_session: ${VIEW_AGENT}`, '    say: b'].join('\n');
    expect(toAppbuilder(src).match(new RegExp(APP_AGENT, 'g'))).toHaveLength(2);
  });
});

describe.each(AB_PAIRS)('%s', (dir) => {
  const source = readFileSync(join(SCENARIOS, dir, 'viewbuilder.yaml'), 'utf8');

  it('the generated appbuilder half is exactly what the source implies (no drift)', () => {
    const r = diffPair(dir);
    expect(r.reason ?? null).toBeNull();
    expect(r.ok).toBe(true);
  });

  it('the transformation touches ONLY builder/id/title lines', () => {
    const { offending } = assertOnlyBuilderDiffers(source);
    expect(offending).toEqual([]);
  });

  it('drives the builder DIRECTLY — this ladder measures the build, not THING routing', () => {
    expect(source).toMatch(/space_session:\s*system-viewbuilder\/automator/);
  });

  it('looks at the app in a real browser, and clicks it', () => {
    // A ladder that scores apps on `built: true` would have scored the all-blank app full marks.
    expect(source).toMatch(/open_app:\s*\{[^}]*render:\s*true/);
    expect(source).toMatch(/open_app:\s*\{[^}]*interact:\s*true/);
  });

  it('carries the visibility and usability invariants both builders are judged on', () => {
    expect(source).toContain('EVERY PAGE IS VISIBLE');
    expect(source).toContain('EVERY PAGE IS USABLE');
    expect(source).toContain('CANNOT EXPRESS IS DECLARED');
  });
});
