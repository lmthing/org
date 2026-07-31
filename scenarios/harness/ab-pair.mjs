#!/usr/bin/env node
/**
 * ab-pair.mjs — generate (and verify) the appbuilder half of an A/B scenario pair.
 *
 * ## Why this exists
 *
 * The A/B ladder (`30-bike-workshop`, `31-food-coop`, `32-festival`) asks one question: **given the
 * same brief, does `system-viewbuilder` produce as good an app as `system-appbuilder`?** That
 * question is only answerable if the two runs really did receive the same brief — and two hand-kept
 * copies of a 40-line brief do not stay identical. They drift by a word, someone "improves" one
 * side's wording, and the comparison quietly stops being a comparison. Worse, the drift is invisible:
 * both files still parse, both still run, and the numbers still look like an A/B.
 *
 * So `viewbuilder.yaml` is the single source of truth and `appbuilder.yaml` is DERIVED from it by
 * exactly two substitutions:
 *
 *   - `id:` — the trailing `-view` becomes `-app`, so the two runs are distinguishable in evidence;
 *   - `space_session:` — `system-viewbuilder/automator` becomes `system-appbuilder/automator`.
 *
 * Nothing else may differ, and {@link diffPair} proves it by transforming the source and comparing
 * byte-for-byte. `--check` is the assertion (used by the test); the default writes the file.
 *
 * Both builders expose the same entry point — `defaultAction: build_live_project`, the same tasklist
 * name, the same `{query, attachmentIds}` input — which is what makes the substitution sufficient.
 * Neither builder's nodes declare a `model:`, so both also run on the same default slot alias.
 *
 *   node scenarios/harness/ab-pair.mjs                 # regenerate every pair
 *   node scenarios/harness/ab-pair.mjs --check         # verify, exit 1 on drift
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SCENARIOS = join(HERE, '..');

/** The scenario dirs that carry an A/B pair. */
export const AB_PAIRS = ['30-bike-workshop', '31-food-coop', '32-festival'];

export const VIEW_AGENT = 'system-viewbuilder/automator';
export const APP_AGENT = 'system-appbuilder/automator';

/**
 * The whole transformation, as a pure string function so it is testable without touching disk.
 *
 * Deliberately narrow: it rewrites the `space_session:` VALUE and the `id:` SUFFIX and nothing else.
 * A broad `replaceAll('viewbuilder', 'appbuilder')` would also rewrite the prose in the header
 * comment — including the sentences explaining what the pair is — and a generated file whose
 * explanation of itself has been silently mangled is how a harness stops being trusted.
 */
export function toAppbuilder(source) {
  return source
    .replace(/^(id:\s*\S*?)-view\s*$/m, '$1-app')
    .replace(new RegExp(`^(\\s*(?:- )?space_session:\\s*)${VIEW_AGENT}\\s*$`, 'gm'), `$1${APP_AGENT}`)
    .replace(/^(title:\s*".*?)\(viewbuilder\)"$/m, '$1(appbuilder)"');
}

/** `{ok}` when the on-disk appbuilder half is exactly what the source implies; `{ok:false, …}` otherwise. */
export function diffPair(dir) {
  const src = join(SCENARIOS, dir, 'viewbuilder.yaml');
  const dst = join(SCENARIOS, dir, 'appbuilder.yaml');
  if (!existsSync(src)) return { ok: false, dir, reason: `no viewbuilder.yaml in ${dir}` };
  const expected = toAppbuilder(readFileSync(src, 'utf8'));
  if (!existsSync(dst)) return { ok: false, dir, reason: `${dir}/appbuilder.yaml has not been generated`, expected };
  const actual = readFileSync(dst, 'utf8');
  if (actual === expected) return { ok: true, dir };
  const a = actual.split('\n');
  const e = expected.split('\n');
  const at = a.findIndex((l, i) => l !== e[i]);
  return {
    ok: false,
    dir,
    reason: `${dir}/appbuilder.yaml has DRIFTED from viewbuilder.yaml at line ${at + 1}:\n  generated: ${e[at] ?? '(end of file)'}\n  on disk:   ${a[at] ?? '(end of file)'}`,
    expected,
  };
}

/** Verify the transformation touched the builder and nothing else. Used by the test AND by --check. */
export function assertOnlyBuilderDiffers(source) {
  const out = toAppbuilder(source);
  const a = source.split('\n');
  const b = out.split('\n');
  const changed = a.map((l, i) => (l === b[i] ? null : i)).filter((i) => i !== null);
  const offending = changed.filter((i) => !/^\s*(?:- )?(?:space_session|id|title):/.test(a[i]));
  return { changed: changed.length, offending: offending.map((i) => a[i]) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes('--check');
  let bad = 0;
  for (const dir of AB_PAIRS) {
    const r = diffPair(dir);
    if (r.ok) {
      console.log(`✓ ${dir}`);
      continue;
    }
    if (check || !r.expected) {
      console.error(`✗ ${r.reason}`);
      bad++;
      continue;
    }
    writeFileSync(join(SCENARIOS, dir, 'appbuilder.yaml'), r.expected);
    console.log(`→ wrote ${dir}/appbuilder.yaml`);
  }
  process.exit(bad ? 1 : 0);
}
