/**
 * {@link saveTypecheckFile} — the SAVE-TIME single-file partial typecheck the `writeProject*`
 * writers run (see `./save-typecheck.ts`). These tests exercise the FUNCTION directly, so the
 * narrowed-vs-generic mode, the contract-root resolution and the sibling tolerance are isolated
 * from the writers' other lint passes.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { saveTypecheckFile } from './save-typecheck.js';

describe('saveTypecheckFile', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'lm-savetc-fn-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function endpoint(dirSegs: string[], method: string, name: string) {
    mkdirSync(join(root, 'api', ...dirSegs), { recursive: true });
    writeFileSync(
      join(root, 'api', ...dirSegs, `${method}.ts`),
      `export const name = '${name}';\nexport default () => ({ items: [] });`,
    );
  }
  const check = (relPath: string, src: string) => saveTypecheckFile({ projectRoot: root, relPath, src });

  // ── Hook RESULT-SHAPE misuse (caught regardless of mode) ─────────────────────────
  it('flags `.mutateAsync` on a useApiMutation result', () => {
    endpoint(['t'], 'POST', 'tCreate');
    const d = check('pages/x.tsx', "import { useApiMutation } from '@app/runtime';\nexport default function P(){ const m=useApiMutation('tCreate'); m.mutateAsync({}); return <div/>; }");
    expect(d?.message).toMatch(/mutateAsync/);
    expect(d?.file).toBe('pages/x.tsx');
    expect(d?.line).toBeTypeOf('number');
  });

  it('flags `.items` on an untyped useApi result (unknown)', () => {
    endpoint(['t'], 'GET', 'tList');
    const d = check('pages/x.tsx', "import { useApi } from '@app/runtime';\nexport default function P(){ const {data}=useApi('tList'); return <div>{String(data.items)}</div>; }");
    expect(d).not.toBeNull();
    expect(d?.message).toMatch(/unknown|data/i);
  });

  it('flags a handler using `apiHandler` (an undeclared name)', () => {
    endpoint(['t'], 'GET', 'tList');
    const d = check('api/foo/GET.ts', "export const name='foo';\nexport default apiHandler(async () => ({}));");
    expect(d?.message).toMatch(/apiHandler/);
  });

  // ── Narrowed endpoint names (STRICT when the project has endpoints) ───────────────
  it('REJECTS an unknown endpoint name when the project already has endpoints (narrowed)', () => {
    endpoint(['t'], 'GET', 'tList');
    const d = check('pages/x.tsx', "import { useApi } from '@app/runtime';\nexport default function P(){ const {data}=useApi<{items:any[]}>('nope'); return <div>{(data?.items??[]).length}</div>; }");
    expect(d).not.toBeNull(); // 'nope' is not in the endpoint-name union
  });

  it('degrades to the generic hooks ONLY when the project has NO endpoints (builder fallback)', () => {
    // No api/ dir at all → buildClientApiDts('') → generic `name: string`; any name compiles.
    const d = check('pages/x.tsx', "import { useApi } from '@app/runtime';\nexport default function P(){ const {data}=useApi<{items:any[]}>('anything'); return <div>{(data?.items??[]).length}</div>; }");
    expect(d).toBeNull();
  });

  // ── The sole added tolerance: unresolved relative siblings ────────────────────────
  it('ACCEPTS a not-yet-written relative sibling import (stubbed as any)', () => {
    const d = check('components/Card.tsx', "import Missing from '../components/NotYet';\nimport { helper } from '../hooks/useThing';\nexport default function C(){ helper(); return <Missing />; }");
    expect(d).toBeNull();
  });

  // ── Contract globals: a bare-global contract type resolves via types/contract.d.ts ─
  it('resolves a bare-global contract type from types/contract.d.ts (loaded as a root)', () => {
    endpoint(['cost-lines'], 'GET', 'costLines');
    mkdirSync(join(root, 'types'), { recursive: true });
    // contract.d.ts is a no-export SCRIPT — its interfaces are global, used with NO import.
    writeFileSync(join(root, 'types', 'contract.d.ts'), 'interface CostLinesItem { id: string }\ninterface CostLinesOutput { items: CostLinesItem[] }\n');
    const d = check('pages/x.tsx', "import { useApi } from '@app/runtime';\nexport default function P(){ const {data}=useApi<CostLinesOutput>('costLines'); return <div>{(data?.items??[]).length}</div>; }");
    expect(d).toBeNull();
  });

  it('ACCEPTS a correct page — real endpoint, generic, null-guard, `.mutate`', () => {
    endpoint(['t'], 'GET', 'tList');
    endpoint(['t'], 'POST', 'tCreate');
    const d = check('pages/x.tsx', [
      "import { useApi, useApiMutation } from '@app/runtime';",
      'export default function P(){',
      "  const { data } = useApi<{ items: { id: string }[] }>('tList');",
      "  const m = useApiMutation('tCreate');",
      '  return <div onClick={() => m.mutate({})}>{(data?.items ?? []).length}</div>;',
      '}',
    ].join('\n'));
    expect(d).toBeNull();
  });
});
