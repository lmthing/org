/**
 * Harness dispatch at the session-build choke point.
 *
 * Every creation path calls the manager's `buildSessionFn`, which resolves the
 * project's harness and hands off to that harness's provider. These tests pin
 * that dispatch with fake providers (no VM, no disk beyond project.json): the
 * built-in `'lmthing'` provider wraps the injected `buildSession`, an added
 * `'dsh'` provider is selected for a project pinned to it, and a project pinned
 * to a harness with no provider fails loud.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session } from '@lmthing/core';
import { SessionManager, HarnessUnavailableError } from './session-manager.js';
import type { BuildSessionArgs, HarnessProvider } from './session-manager.js';
import { createProjectSync } from './projects.js';
import type { HarnessId } from './harness.js';

/** The private choke point these tests drive directly. */
type ManagerPriv = { dispatchBuildSession: (a: BuildSessionArgs) => Session };

function fakeProvider(id: HarnessId, calls: HarnessId[]): HarnessProvider {
  return {
    id,
    label: `fake-${id}`,
    buildSession: () => {
      calls.push(id);
      return { tag: id } as unknown as Session;
    },
  };
}

describe('SessionManager harness dispatch', () => {
  let root: string;
  const calls: HarnessId[] = [];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'lmroot-'));
    calls.length = 0;
    delete process.env['LMTHING_HARNESS'];
  });
  afterEach(() => {
    delete process.env['LMTHING_HARNESS'];
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  function makeManager(extraProviders: HarnessProvider[] = []): SessionManager {
    return new SessionManager({
      lmthingRoot: root,
      snapshotsDir: join(root, '.snaps'),
      streamFn: () => Promise.reject(new Error('streamFn should not be called')),
      // The built-in lmthing provider wraps this injected builder.
      buildSession: () => {
        calls.push('lmthing');
        return { tag: 'lmthing' } as unknown as Session;
      },
      harnessProviders: extraProviders,
    });
  }

  const dispatch = (m: SessionManager, projectId?: string) =>
    (m as unknown as ManagerPriv).dispatchBuildSession({ projectId } as BuildSessionArgs);

  it('routes an unpinned project to the lmthing provider', () => {
    createProjectSync(root, 'Plain');
    const m = makeManager([fakeProvider('dsh', calls)]);
    dispatch(m, 'plain');
    expect(calls).toEqual(['lmthing']);
  });

  it('routes a project pinned to dsh to the dsh provider', () => {
    createProjectSync(root, 'On DSH', 'dsh');
    const m = makeManager([fakeProvider('dsh', calls)]);
    dispatch(m, 'on-dsh');
    expect(calls).toEqual(['dsh']);
  });

  it('routes a session with no project to lmthing (headless/legacy)', () => {
    const m = makeManager([fakeProvider('dsh', calls)]);
    dispatch(m, undefined);
    expect(calls).toEqual(['lmthing']);
  });

  it('honours the pod default when a project is unpinned', () => {
    process.env['LMTHING_HARNESS'] = 'dsh';
    createProjectSync(root, 'Plain');
    const m = makeManager([fakeProvider('dsh', calls)]);
    dispatch(m, 'plain');
    expect(calls).toEqual(['dsh']);
  });

  it('throws HarnessUnavailableError when the pinned harness has no provider', () => {
    createProjectSync(root, 'On DSH', 'dsh');
    const m = makeManager(); // no dsh provider registered
    expect(() => dispatch(m, 'on-dsh')).toThrow(HarnessUnavailableError);
    expect(calls).toEqual([]);
    expect(m.availableHarnesses()).toEqual(['lmthing']);
  });

  it('registerHarness adds a provider after construction', () => {
    createProjectSync(root, 'On DSH', 'dsh');
    const m = makeManager();
    m.registerHarness(fakeProvider('dsh', calls));
    dispatch(m, 'on-dsh');
    expect(calls).toEqual(['dsh']);
    expect(m.availableHarnesses().sort()).toEqual(['dsh', 'lmthing']);
  });
});
