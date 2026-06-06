import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Router } from './router.js';
import type { RouterInput, RouterState } from './router.js';

// Minimal no-op TraceWriter
function makeTrace() {
  const events: Array<Record<string, unknown>> = [];
  return {
    write: vi.fn((event: Record<string, unknown>) => { events.push(event); }),
    readSuffix: vi.fn(() => []),
    _events: events,
  };
}

function baseState(): RouterState {
  return {
    errorStreak: 0,
    annotationMismatchStreak: 0,
    analyzerRefires: 0,
    cachedDifficulty: null,
    lastInstructionCycle: 0,
    budgetWarning: false,
    heapWarning: false,
    recoveryContext: false,
  };
}

function baseInput(overrides: Partial<RouterInput> = {}): RouterInput {
  return {
    trigger: 'post_inspect',
    cycle: 1,
    tokensRemaining: 8000,
    heapMB: 10,
    heapMaxMB: 64,
    errorStreak: 0,
    annotationMismatchStreak: 0,
    hasTasklist: true,
    hasInProgressTask: false,
    tasksCompleted: 0,
    totalTasks: 0,
    state: baseState(),
    ...overrides,
  };
}

describe('Router', () => {
  let trace: ReturnType<typeof makeTrace>;
  let router: Router;

  beforeEach(() => {
    trace = makeTrace();
    router = new Router({
      trace: trace as never,
      resolveAlias: (alias) => `mock:${alias}`,
    });
  });

  it('Rule 1: annotationMismatchStreak=2 → escalation decision with recoveryContext=true', () => {
    const decision = router.decide(baseInput({ annotationMismatchStreak: 2 }));
    expect(decision.flags.recoveryContext).toBe(true);
    expect(decision.alias).toBe('M');
    expect(decision.role).toBe('EXEC_ELEVATED');
  });

  it('Rule 3: errorStreak=3 → RECOVERY + M_R', () => {
    const decision = router.decide(baseInput({ errorStreak: 3 }));
    expect(decision.role).toBe('RECOVERY');
    expect(decision.alias).toBe('M_R');
    expect(decision.reasoningOn).toBe(true);
  });

  it('Rule 4: errorStreak=5 → RECOVERY + L_R', () => {
    const decision = router.decide(baseInput({ errorStreak: 5 }));
    expect(decision.role).toBe('RECOVERY');
    expect(decision.alias).toBe('L_R');
    expect(decision.reasoningOn).toBe(true);
  });

  it('Rule 7: no tasklist + new_message → ANALYZER alias=XS', () => {
    const decision = router.decide(baseInput({
      trigger: 'new_message',
      hasTasklist: false,
      errorStreak: 0,
    }));
    expect(decision.role).toBe('ANALYZER');
    expect(decision.alias).toBe('XS');
  });

  it('Rule 11: tokensRemaining < 2000 → budgetWarning flag', () => {
    const decision = router.decide(baseInput({ tokensRemaining: 1500 }));
    expect(decision.flags.budgetWarning).toBe(true);
  });

  it('Rule 12: heapMB > 80% of heapMaxMB → heapWarning flag', () => {
    const decision = router.decide(baseInput({ heapMB: 55, heapMaxMB: 64 })); // 55 > 51.2
    expect(decision.flags.heapWarning).toBe(true);
  });

  it('Rule 13: default → EXEC_STANDARD + S', () => {
    const decision = router.decide(baseInput());
    expect(decision.role).toBe('EXEC_STANDARD');
    expect(decision.alias).toBe('S');
    expect(decision.flags.budgetWarning).toBe(false);
    expect(decision.flags.heapWarning).toBe(false);
    expect(decision.flags.recoveryContext).toBe(false);
  });

  it('resetForNewInstruction clears errorStreak, annotationMismatchStreak, cachedDifficulty', () => {
    const state: RouterState = {
      errorStreak: 4,
      annotationMismatchStreak: 3,
      analyzerRefires: 1,
      cachedDifficulty: 'complex',
      lastInstructionCycle: 5,
      budgetWarning: true,
      heapWarning: false,
      recoveryContext: true,
    };
    const next = router.resetForNewInstruction(state);
    expect(next.errorStreak).toBe(0);
    expect(next.annotationMismatchStreak).toBe(0);
    expect(next.analyzerRefires).toBe(0);
    expect(next.cachedDifficulty).toBeNull();
    // Non-reset fields preserved
    expect(next.lastInstructionCycle).toBe(5);
  });

  it('Router emits router_decision trace event with correct fields', () => {
    router.decide(baseInput());
    const event = trace._events.find((e) => e['type'] === 'router_decision');
    expect(event).toBeDefined();
    expect(event!['role']).toBe('EXEC_STANDARD');
    expect(event!['alias']).toBe('S');
    expect(event!['modelSpec']).toBe('mock:S');
    expect(event!['trigger']).toBe('post_inspect');
    expect(event!['cycle']).toBe(1);
  });

  it('First match wins: errorStreak=5 + tokensRemaining < 2000 → RECOVERY (not budget branch)', () => {
    const decision = router.decide(baseInput({
      errorStreak: 5,
      tokensRemaining: 500,
    }));
    // Rule 4 (errorStreak≥5) fires before Rule 11 (budget)
    expect(decision.role).toBe('RECOVERY');
    expect(decision.alias).toBe('L_R');
    expect(decision.flags.budgetWarning).toBe(false);
  });
});
