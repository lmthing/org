/**
 * Drift guard for {@link ./tokens.ts}.
 *
 * `INVISIBLE_AS_TEXT` is a hand-materialized constant so the write-time lint has zero runtime
 * dependency on resolving a JSON file out of another workspace package (a resolution that would
 * fail SILENTLY in the pod image and turn the check into a no-op gate — the exact failure mode the
 * appbuilder plan exists to kill). This test is what keeps it honest: it re-derives the set from
 * `libs/css/src/tokens/tokens.json` and asserts an exact match, so any palette edit that changes a
 * colour's `role` or its contrast lands here as a red test rather than as a silently-stale lint.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { INVISIBLE_AS_TEXT, textTokenFor } from './tokens.js';

interface ColorToken {
  name: string;
  group: string;
  role?: 'surface' | 'text';
  light: string;
  dark: string;
  description: string;
}

const TOKENS_JSON = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../css/src/tokens/tokens.json',
);

function tokens(): { colors: ColorToken[] } {
  return JSON.parse(readFileSync(TOKENS_JSON, 'utf8')) as { colors: ColorToken[] };
}

/** sRGB relative luminance (WCAG 2.1). */
function luminance([r, g, b]: number[]): number {
  const [R, G, B] = [r!, g!, b!].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * R! + 0.7152 * G! + 0.0722 * B!;
}

function contrast(a: number[], b: number[]): number {
  const [l1, l2] = [luminance(a), luminance(b)];
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function hex(value: string): number[] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(value.trim());
  return m ? [0, 2, 4].map((i) => parseInt(m[1]!.slice(i, i + 2), 16)) : null;
}

/** The max alpha of an `rgba(…)` overlay token (1 when it carries no alpha). */
function alpha(value: string): number {
  const m = /([\d.]+)\s*\)$/.exec(value);
  return m ? parseFloat(m[1]!) : 1;
}

describe('tokens.json role metadata', () => {
  it('assigns a role to every colour', () => {
    const missing = tokens().colors.filter((c) => c.role !== 'surface' && c.role !== 'text');
    expect(missing.map((c) => c.name)).toEqual([]);
  });

  it('marks exactly the -foreground family as role "text"', () => {
    for (const c of tokens().colors) {
      const isForeground = c.name === 'foreground' || c.name.endsWith('-foreground');
      expect([c.name, c.role]).toEqual([c.name, isForeground ? 'text' : 'surface']);
    }
  });
});

describe('INVISIBLE_AS_TEXT', () => {
  it('is exactly the surface tokens that are unreadable as text (contrast < 2:1)', () => {
    const all = tokens().colors;
    const by = (n: string) => all.find((c) => c.name === n)!;
    const grounds = {
      light: [hex(by('background').light)!, hex(by('card').light)!],
      dark: [hex(by('background').dark)!, hex(by('card').dark)!],
    };

    const derived: string[] = [];
    for (const c of all) {
      if (c.role !== 'surface') continue;
      const [L, D] = [hex(c.light), hex(c.dark)];
      if (!L || !D) {
        // An alpha overlay (hover/active/focus): too transparent to read as text.
        if (Math.max(alpha(c.light), alpha(c.dark)) < 0.6) derived.push(c.name);
        continue;
      }
      const worst = Math.min(
        ...grounds.light.map((g) => contrast(L, g)),
        ...grounds.dark.map((g) => contrast(D, g)),
      );
      if (worst < 2) derived.push(c.name);
    }

    expect([...INVISIBLE_AS_TEXT].sort()).toEqual(derived.sort());
  });

  it('never lists a text token — the fix must always be reachable', () => {
    const text = new Set(tokens().colors.filter((c) => c.role === 'text').map((c) => c.name));
    for (const t of INVISIBLE_AS_TEXT) expect(text.has(t)).toBe(false);
  });

  it('suggests a real, defined token for every entry', () => {
    const defined = new Set(tokens().colors.map((c) => c.name));
    for (const t of INVISIBLE_AS_TEXT) {
      const fix = textTokenFor(t);
      expect([t, defined.has(fix)]).toEqual([t, true]);
      // The suggestion must not itself be invisible.
      expect([t, INVISIBLE_AS_TEXT.includes(fix)]).toEqual([t, false]);
    }
  });
});
