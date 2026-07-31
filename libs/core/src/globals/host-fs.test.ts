import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHostFsGlobals } from './host-fs.js';
import { resolveHostFsYield } from '../eval/host-fs-yield.js';
import { parseCapabilities } from '../spaces/capabilities.js';
import { sessionCapabilities, forkCapabilities, intersectAppCaps } from '../exec/capability.js';
import type { YieldRequest } from '../eval/yield.js';

const CTX = { agentId: 'test-agent' };

afterEach(() => {
  delete process.env['LMTHING_TEAM_MODE'];
});

describe('the local-fs globals', () => {
  it('every call is rootId + RELATIVE path — there is no absolute-path form', () => {
    // The security design, asserted as a shape. A path outside every grant is not rejected, it is
    // inexpressible: the pod cannot even describe one. If a future signature took an absolute
    // path, this test is the one that should stop it.
    const seen: YieldRequest[] = [];
    const g = createHostFsGlobals((r) => seen.push(r));

    void g.localRead('root-1', 'src/main.ts');
    void g.localWrite('root-1', 'src/main.ts', 'hello');
    void g.localTree('root-1');
    void g.localSearch('root-1', 'TODO');

    expect(seen.map((r) => r.kind)).toEqual(['hostFs', 'hostFs', 'hostFs', 'hostFs']);
    expect(seen[0]!.args).toEqual(['read', 'root-1', 'src/main.ts', undefined]);
    expect(seen[1]!.args).toEqual(['write', 'root-1', 'src/main.ts', 'hello']);
    expect(seen[2]!.args).toEqual(['tree', 'root-1', undefined]);
    expect(seen[3]!.args).toEqual(['search', 'root-1', 'TODO', undefined]);
  });

  it('yields rather than calling a host function synchronously', () => {
    // `globals/host-tools.ts` marshals its primitives as SYNCHRONOUS host calls, so a remote
    // filesystem could never be a drop-in there. Every one of these must be a suspension.
    const seen: YieldRequest[] = [];
    const g = createHostFsGlobals((r) => seen.push(r));
    const p = g.localRoots();
    expect(p).toBeInstanceOf(Promise);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.vmPromiseHandle).toBeUndefined();
  });
});

describe('resolveHostFsYield', () => {
  it('never throws — a refusal is DATA the model can read, not an exception', async () => {
    // A grant-jail refusal is a normal outcome: it is what the agent is told when it asks for
    // something outside the granted folders. Throwing would end the turn instead of letting the
    // model try somewhere it is allowed.
    const resolver = vi.fn().mockRejectedValue(new Error('path escapes the granted folder'));
    const out = (await resolveHostFsYield(resolver, 'read', ['r1', 'x'])) as { ok: boolean; error?: string };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/escapes the granted folder/);
  });

  it('reports a missing bridge in each op’s own result shape', async () => {
    const read = (await resolveHostFsYield(undefined, 'read', [])) as { ok: boolean; content: string };
    expect(read).toMatchObject({ ok: false, content: '', lines: 0 });
    const write = (await resolveHostFsYield(undefined, 'write', [])) as { ok: boolean; bytes: number };
    expect(write).toMatchObject({ ok: false, bytes: 0 });
    const tree = (await resolveHostFsYield(undefined, 'tree', [])) as { ok: boolean; entries: unknown[] };
    expect(tree).toMatchObject({ ok: false, entries: [] });
  });

  it('answers `roots` with an empty list rather than an error envelope', async () => {
    // "Which folders may I see" has no partial answer, and `for (const r of await localRoots())`
    // must not throw just because the laptop is asleep.
    await expect(resolveHostFsYield(undefined, 'roots', [])).resolves.toEqual([]);
    const resolver = vi.fn().mockResolvedValue([{ id: 'r1', label: 'code', mode: 'rw' }]);
    await expect(resolveHostFsYield(resolver, 'roots', [])).resolves.toEqual([
      { id: 'r1', label: 'code', mode: 'rw' },
    ]);
  });
});

describe('the fs:local capabilities', () => {
  it('are recognised, and are bare-only — an agent cannot widen its own scope', () => {
    const caps = parseCapabilities(['fs:local:read', 'fs:local:write'], CTX);
    expect(caps['fs:local:read']).toBe(true);
    expect(caps['fs:local:write']).toBe(true);
    // The grant list belongs to the PERSON and lives on their machine. Frontmatter that could
    // name folders would let an agent widen scope, which is exactly what must be impossible.
    expect(() => parseCapabilities([{ 'fs:local:read': { roots: ['/'] } }], CTX)).toThrow();
  });

  it('are DROPPED on a team pod, not rejected', () => {
    // Dropped, because one `instruct.md` ships to both kinds of pod and throwing would make the
    // space fail to load on a team pod entirely. Absent, because a team pod is shared: an agent
    // there can be prompted by anyone with channel write access, and this would hand that agent a
    // path to one member's laptop.
    process.env['LMTHING_TEAM_MODE'] = '1';
    const caps = parseCapabilities(['fs:local:read', 'fs:local:write', 'db:read'], CTX);
    expect(caps['fs:local:read']).toBeUndefined();
    expect(caps['fs:local:write']).toBeUndefined();
    expect(caps['db:read']).toBeDefined();
  });

  it('drive injection AND the DTS from one profile, at every context kind', () => {
    const app = parseCapabilities(['fs:local:read', 'fs:local:write'], CTX);
    const session = sessionCapabilities(true, app);
    expect(session.localFsRead).toBe(true);
    expect(session.localFsWrite).toBe(true);

    const none = sessionCapabilities(true, parseCapabilities([], CTX));
    expect(none.localFsRead).toBe(false);
    expect(none.localFsWrite).toBe(false);
  });

  it('a READ-ONLY fork keeps the reader and loses the writer', () => {
    // The concrete reason this is two capability ids rather than one. A single `fs:local` would
    // have to be kept whole (arming a read-only fork with writers) or dropped whole (blinding it),
    // and an explore/plan fork reading a local repository is the most obvious use of the feature.
    const app = parseCapabilities(['fs:local:read', 'fs:local:write'], CTX);
    const readOnly = intersectAppCaps(app, false);
    expect(readOnly['fs:local:read']).toBe(true);
    expect(readOnly['fs:local:write']).toBeUndefined();

    // 'explore' is one of the read-only roles (see roleProfile).
    const fork = forkCapabilities('explore', true, app);
    expect(fork.localFsRead).toBe(true);
    expect(fork.localFsWrite).toBe(false);
  });
});
