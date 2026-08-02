/**
 * `check()` — the third leg of the W7 triad (§7): `compile()` (entity.ts) / `generate()` (query.ts) /
 * `check()` (here). Regenerates every declarative artifact from its `.entity.json`/`.query.json`
 * source and byte-compares it against what is actually on disk. A mismatch means one of two things,
 * and the message names which: the generated file was **hand-edited** (a human or a model touched
 * `database/<name>.json` or `api/<route>/<METHOD>.ts` directly instead of the IR that owns it), or it
 * is simply **missing/stale** (the IR changed and nothing regenerated it yet). Either way this is a
 * HARD error — §7's acceptance criterion ("a hand-edited generated file is a hard error") exists
 * because a generated file that silently drifts from its IR is exactly the class of bug W7 exists to
 * make impossible: the whole point is that the handler CANNOT disagree with its own contract, which
 * only holds if the file on disk really is what the IR compiles to.
 *
 * This module only READS the project (`model/*.entity.json`, `api/*.query.json`, `database/*.json`,
 * `api/**\/<METHOD>.ts`) — it never writes. The writers that keep the two in sync at authoring time
 * live in `authoring/globals.ts` (`writeProjectEntity`/`writeProjectQuery`).
 */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { loadProjectApp } from '../loader.js';
import { validateEntityIr, compileEntity, type EntityIr, type FactRecord } from './entity.js';
import { validateQueryIr, generateQueryHandler, type QueryIr } from './query.js';

export interface GenCheckError {
  kind: 'entity' | 'query';
  /** The `.entity.json`/`.query.json` source, project-relative. */
  source: string;
  /** The generated artifact this source projects to, project-relative. */
  generated: string;
  reason: 'invalid' | 'missing' | 'mismatch';
  message: string;
}

export interface GenCheckResult {
  ok: boolean;
  errors: GenCheckError[];
}

/** List `<dir>/*.<ext>` file basenames (no recursion — both `model/` and the top-level `api/` IR
 *  sources are flat by design, §2). `[]` when the dir is absent. */
async function listJson(dir: string, ext: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(ext))
    .map((e) => e.name.slice(0, -ext.length));
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'));
}

/** The canonical on-disk serialization every entity/query writer must produce — `check()`'s
 *  byte-comparison baseline. Exported so the writers (`authoring/globals.ts`) use the SAME
 *  formatting and can never drift from what this module considers "in sync". */
export function serializeTableSchema(schema: unknown): string {
  return JSON.stringify(schema, null, 2) + '\n';
}

/**
 * Regenerate every `model/*.entity.json` → `database/<name>.json` and every `api/*.query.json` →
 * `api/<route>/<METHOD>.ts`, byte-comparing each against disk. Entities are processed in a stable
 * (alphabetical) order so the fact registry (cross-entity "one vocabulary per fact forever" / "a fact
 * key names one column" checks) is built deterministically before queries are checked.
 */
export async function checkGeneratedIr(projectRoot: string): Promise<GenCheckResult> {
  const errors: GenCheckError[] = [];

  // ── entities: model/<name>.entity.json → database/<name>.json ──────────────
  const entityNames = (await listJson(join(projectRoot, 'model'), '.entity.json')).sort();
  const factRegistry = new Map<string, FactRecord>();
  const knownEntities = new Set(entityNames);

  for (const name of entityNames) {
    const source = `model/${name}.entity.json`;
    const generated = `database/${name}.json`;
    let ir: unknown;
    try {
      ir = await readJson(join(projectRoot, source));
    } catch (e) {
      errors.push({ kind: 'entity', source, generated, reason: 'invalid', message: `unreadable/invalid JSON: ${errMessage(e)}` });
      continue;
    }
    const validation = validateEntityIr(ir, { existingFacts: factRegistry, knownEntities });
    if (!validation.ok) {
      errors.push({ kind: 'entity', source, generated, reason: 'invalid', message: validation.errors.join('; ') });
      continue;
    }
    const { schema, facts } = compileEntity(ir as EntityIr);
    for (const [fact, rec] of facts) factRegistry.set(fact, rec);

    const expected = serializeTableSchema(schema);
    let actual: string;
    try {
      actual = await readFile(join(projectRoot, generated), 'utf8');
    } catch {
      errors.push({ kind: 'entity', source, generated, reason: 'missing', message: `not generated yet — run \`generate\` (or writeProjectEntity) for ${source}` });
      continue;
    }
    if (actual !== expected) {
      errors.push({
        kind: 'entity',
        source,
        generated,
        reason: 'mismatch',
        message: `${generated} does not match what ${source} compiles to — it was hand-edited (or the table predates the entity model). Edit ${source} and let it regenerate; never hand-edit a generated table schema.`,
      });
    }
  }

  // ── queries: api/<name>.query.json → api/<route>/<METHOD>.ts ───────────────
  const queryNames = (await listJson(join(projectRoot, 'api'), '.query.json')).sort();
  if (queryNames.length) {
    const app = await loadProjectApp(projectRoot);
    const tables = new Map(app.tables.map((t) => [t.name, t.schema]));

    for (const name of queryNames) {
      const source = `api/${name}.query.json`;
      let ir: unknown;
      try {
        ir = await readJson(join(projectRoot, source));
      } catch (e) {
        errors.push({ kind: 'query', source, generated: '', reason: 'invalid', message: `unreadable/invalid JSON: ${errMessage(e)}` });
        continue;
      }
      const validation = validateQueryIr(ir, tables);
      if (!validation.ok) {
        errors.push({ kind: 'query', source, generated: '', reason: 'invalid', message: validation.errors.join('; ') });
        continue;
      }
      const { source: expected, apiRoute } = generateQueryHandler(ir as QueryIr, tables);
      const generated = `api/${apiRoute}.ts`;
      let actual: string;
      try {
        actual = await readFile(join(projectRoot, generated), 'utf8');
      } catch {
        errors.push({ kind: 'query', source, generated, reason: 'missing', message: `not generated yet — run \`generate\` (or writeProjectQuery) for ${source}` });
        continue;
      }
      if (actual !== expected) {
        errors.push({
          kind: 'query',
          source,
          generated,
          reason: 'mismatch',
          message: `${generated} does not match what ${source} compiles to — it was hand-edited. Edit ${source} and let it regenerate; a generated handler is never hand-editable (escape hatch: api/<name>.handler.ts).`,
        });
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
