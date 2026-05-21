/**
 * Router — Phase 12
 *
 * Host-side decision engine that fires at two points in the agent loop:
 *   - new_message: when a new user instruction arrives
 *   - post_inspect: after an inspect() cycle completes
 *
 * Rules are evaluated in order; first match wins.
 */
import type { TraceWriter } from '@lmthing/llm-repl/lib/sandbox/trace';
import type { AnalyzerResult } from './analyzer.js';

export type ModelAlias = 'XS' | 'S' | 'M' | 'M_R' | 'L' | 'L_R';
export type RoleName =
  | 'EXEC_STANDARD'
  | 'EXEC_ELEVATED'
  | 'RECOVERY'
  | 'PLANNER_DEEP'
  | 'ANALYZER';

export interface RouterState {
  errorStreak: number;
  annotationMismatchStreak: number;
  analyzerRefires: number;
  cachedDifficulty: 'simple' | 'moderate' | 'complex' | null;
  lastInstructionCycle: number;
  budgetWarning: boolean;
  heapWarning: boolean;
  recoveryContext: boolean;
}

export interface RouterDecision {
  role: RoleName;
  alias: ModelAlias;
  reasoningOn: boolean;
  flags: {
    budgetWarning: boolean;
    heapWarning: boolean;
    recoveryContext: boolean;
  };
  rationale: string;
}

export interface RouterInput {
  trigger: 'new_message' | 'post_inspect';
  cycle: number;
  tokensRemaining: number;
  heapMB: number;
  heapMaxMB: number;
  errorStreak: number;
  annotationMismatchStreak: number;
  analyzerResult?: AnalyzerResult;
  hasTasklist: boolean;
  hasInProgressTask: boolean;
  tasksCompleted: number;
  totalTasks: number;
  state: RouterState;
}

export interface RouterOptions {
  trace: TraceWriter;
  resolveAlias: (alias: ModelAlias) => string;
}

function reasoningOn(alias: ModelAlias): boolean {
  return alias === 'M_R' || alias === 'L_R';
}

export class Router {
  private readonly _trace: TraceWriter;
  private readonly _resolveAlias: (alias: ModelAlias) => string;

  constructor(opts: RouterOptions) {
    this._trace = opts.trace;
    this._resolveAlias = opts.resolveAlias;
  }

  /**
   * Evaluate routing rules and emit a RouterDecision.
   * Rules are checked in the spec order; first match wins.
   */
  decide(input: RouterInput): RouterDecision {
    const {
      trigger,
      tokensRemaining,
      heapMB,
      heapMaxMB,
      errorStreak,
      annotationMismatchStreak,
      analyzerResult,
      hasTasklist,
      hasInProgressTask,
      tasksCompleted,
      totalTasks,
      state,
    } = input;

    const difficulty = analyzerResult?.difficulty ?? state.cachedDifficulty;

    let decision: RouterDecision;

    // Rule 1: annotation mismatch streak ≥ 2 → escalate one tier + recovery context
    if (annotationMismatchStreak >= 2) {
      // Escalate: determine current tier from error streak context, default to S→M escalation
      const escalatedAlias: ModelAlias = 'M';
      decision = {
        role: 'EXEC_ELEVATED',
        alias: escalatedAlias,
        reasoningOn: false,
        flags: {
          budgetWarning: false,
          heapWarning: false,
          recoveryContext: true,
        },
        rationale: `annotationMismatchStreak=${annotationMismatchStreak} ≥ 2 — escalating to ${escalatedAlias} with recovery context`,
      };
    }

    // Rule 3: errorStreak ≥ 5 → RECOVERY + L_R (frontier reasoning)
    else if (errorStreak >= 5) {
      decision = {
        role: 'RECOVERY',
        alias: 'L_R',
        reasoningOn: true,
        flags: {
          budgetWarning: false,
          heapWarning: false,
          recoveryContext: true,
        },
        rationale: `errorStreak=${errorStreak} ≥ 5 — frontier reasoning recovery`,
      };
    }

    // Rule 3: errorStreak ≥ 3 → RECOVERY + M_R (30-70B reasoning)
    else if (errorStreak >= 3) {
      decision = {
        role: 'RECOVERY',
        alias: 'M_R',
        reasoningOn: true,
        flags: {
          budgetWarning: false,
          heapWarning: false,
          recoveryContext: true,
        },
        rationale: `errorStreak=${errorStreak} ≥ 3 — mid-range reasoning recovery`,
      };
    }

    // Rule 5: errorStreak ≥ 2 → RECOVERY + M
    else if (errorStreak >= 2) {
      decision = {
        role: 'RECOVERY',
        alias: 'M',
        reasoningOn: false,
        flags: {
          budgetWarning: false,
          heapWarning: false,
          recoveryContext: true,
        },
        rationale: `errorStreak=${errorStreak} ≥ 2 — recovery mode`,
      };
    }

    // Rule 6: errorStreak ≥ 1 → EXEC_STANDARD + M (recovery note in context)
    else if (errorStreak >= 1) {
      decision = {
        role: 'EXEC_STANDARD',
        alias: 'M',
        reasoningOn: false,
        flags: {
          budgetWarning: false,
          heapWarning: false,
          recoveryContext: true,
        },
        rationale: `errorStreak=${errorStreak} ≥ 1 — standard exec with recovery note`,
      };
    }

    // Rule 7: no tasklist + new_message → XS ANALYZER call
    else if (!hasTasklist && trigger === 'new_message') {
      decision = {
        role: 'ANALYZER',
        alias: 'XS',
        reasoningOn: false,
        flags: {
          budgetWarning: false,
          heapWarning: false,
          recoveryContext: false,
        },
        rationale: 'no tasklist on new_message — running XS analyzer to determine difficulty',
      };
    }

    // Rule 8: in-progress task + complex → PLANNER_DEEP + L_R
    else if (hasInProgressTask && difficulty === 'complex') {
      decision = {
        role: 'PLANNER_DEEP',
        alias: 'L_R',
        reasoningOn: true,
        flags: {
          budgetWarning: false,
          heapWarning: false,
          recoveryContext: false,
        },
        rationale: `in-progress complex task — deep planner with frontier reasoning`,
      };
    }

    // Rule 9: in-progress task + moderate → EXEC_STANDARD + M
    else if (hasInProgressTask && difficulty === 'moderate') {
      decision = {
        role: 'EXEC_STANDARD',
        alias: 'M',
        reasoningOn: false,
        flags: {
          budgetWarning: false,
          heapWarning: false,
          recoveryContext: false,
        },
        rationale: `in-progress moderate task — standard exec with M`,
      };
    }

    // Rule 10: all tasks completed → EXEC_STANDARD + S (finish-up)
    else if (tasksCompleted === totalTasks && totalTasks > 0) {
      decision = {
        role: 'EXEC_STANDARD',
        alias: 'S',
        reasoningOn: false,
        flags: {
          budgetWarning: false,
          heapWarning: false,
          recoveryContext: false,
        },
        rationale: `all ${totalTasks} tasks completed — finish-up with S`,
      };
    }

    // Rule 11: token budget near-exhausted
    else if (tokensRemaining < 2000) {
      decision = {
        role: 'EXEC_STANDARD',
        alias: 'S',
        reasoningOn: false,
        flags: {
          budgetWarning: true,
          heapWarning: false,
          recoveryContext: false,
        },
        rationale: `tokensRemaining=${tokensRemaining} < 2000 — budget warning`,
      };
    }

    // Rule 12: heap pressure
    else if (heapMaxMB > 0 && heapMB > heapMaxMB * 0.8) {
      decision = {
        role: 'EXEC_STANDARD',
        alias: 'S',
        reasoningOn: false,
        flags: {
          budgetWarning: false,
          heapWarning: true,
          recoveryContext: false,
        },
        rationale: `heapMB=${heapMB} > ${heapMaxMB * 0.8} (80% of ${heapMaxMB}MB) — heap warning`,
      };
    }

    // Rule 13: default
    else {
      decision = {
        role: 'EXEC_STANDARD',
        alias: 'S',
        reasoningOn: false,
        flags: {
          budgetWarning: false,
          heapWarning: false,
          recoveryContext: false,
        },
        rationale: 'default routing — standard exec with S',
      };
    }

    this._trace.write({
      type: 'router_decision',
      trigger,
      cycle: input.cycle,
      role: decision.role,
      alias: decision.alias,
      modelSpec: this._resolveAlias(decision.alias),
      reasoningOn: decision.reasoningOn,
      flags: decision.flags,
      rationale: decision.rationale,
    });

    return decision;
  }

  /**
   * Reset per-instruction streaks when a new user instruction arrives.
   */
  resetForNewInstruction(state: RouterState): RouterState {
    return {
      ...state,
      errorStreak: 0,
      annotationMismatchStreak: 0,
      analyzerRefires: 0,
      cachedDifficulty: null,
    };
  }
}
