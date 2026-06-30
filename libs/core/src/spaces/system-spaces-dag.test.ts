import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { loadSpace } from './load.js';
import { loadTasklistFromSpace } from './tasklist-load.js';
import { validateDag, resolveGoalTask } from '../tasklist/dag.js';

/**
 * Structural guard for the shipped system spaces after the role/forEach/charter rewrite:
 * every system-space tasklist must load, validate as a DAG (incl. forEach refs), declare
 * exactly one resolvable goal, and every agent must ship a charter.md. Catches authoring
 * regressions (bad forEach ref, missing goal, dropped charter) without hitting a model.
 */

const SYS = resolve(__dirname, '..', '..', 'system-spaces');

describe('shipped system spaces load + validate', () => {
  for (const name of ['system-architect', 'system-research']) {
    it(`${name}: agents have charters and all tasklists are valid DAGs`, async () => {
      const space = await loadSpace(resolve(SYS, name), { requireAgents: false });
      // Every agent ships a non-trivial charter (fork-safe identity).
      for (const slug of Object.keys(space.agents)) {
        expect(space.agents[slug]!.charterBody.length, `${name}/${slug} charter`).toBeGreaterThan(20);
      }
      // Every tasklist validates and resolves a goal.
      for (const tlName of Object.keys(space.tasklists)) {
        const tasks = await loadTasklistFromSpace(space, tlName);
        expect(() => validateDag(tasks), `${name}/${tlName} DAG`).not.toThrow();
        expect(resolveGoalTask(tasks), `${name}/${tlName} goal`).toBeTruthy();
      }
    });
  }

  it('architect synthesize_and_run uses forEach fan-out with valid roles', async () => {
    const space = await loadSpace(resolve(SYS, 'system-architect'), { requireAgents: false });
    const tasks = await loadTasklistFromSpace(space, 'synthesize_and_run');
    // build_field / build_function fan out over the design step's arrays.
    expect(tasks['build_field']!.forEach).toBe('design.fields');
    expect(tasks['build_function']!.forEach).toBe('design.functions');
    // Read-only steps are explore; file-writing steps are general.
    expect(tasks['design']!.role).toBe('explore');
    expect(tasks['build_field']!.role).toBe('general');
    expect(tasks['validate']!.role).toBe('explore');
    // Every role is one of the three profiles.
    for (const t of Object.values(tasks)) {
      if (t.role) expect(['explore', 'plan', 'general']).toContain(t.role);
    }
  });

  it('research agent exposes shallow research + deep_research (forEach) actions', async () => {
    const space = await loadSpace(resolve(SYS, 'system-research'), { requireAgents: false });
    // deep_research: scope (broad search) -> plan -> investigate (forEach) -> synthesize -> summarize.
    const deep = await loadTasklistFromSpace(space, 'deep_research');
    expect(deep['scope']!.role).toBe('explore');
    expect(deep['scope']!.functions).toEqual(['webSearch']);
    expect(deep['investigate']!.forEach).toBe('plan.questions');
    expect(deep['investigate_a']).toBeUndefined();
    // synthesize clusters/dedupes but is no longer the goal — summarize writes the final report.
    expect(deep['synthesize']!.goal).toBeFalsy();
    expect(resolveGoalTask(deep)!.id).toBe('summarize');
    // research: a single shallow quick-answer task.
    const shallow = await loadTasklistFromSpace(space, 'research');
    expect(Object.keys(shallow)).toEqual(['answer']);
    expect(resolveGoalTask(shallow)!.id).toBe('answer');
  });
});
