/**
 * Token budget tracking for session context management.
 */

export interface Budget {
  tokensRemaining: number;
  tokensUsed: number;
  inspectCount: number;
  forksActive: number;
  forksCompleted: number;
  nearingLimit: boolean;
  context: {
    used: number;
    max: number;
    scopeTokens: number;
    sourceTokens: number;
    wastedOnAbort: number;
  };
  execution: {
    statementsTotal: number;
    statementsSinceInspect: number;
    heapMB: number;
    heapMaxMB: number;
  };
}

export class BudgetTracker {
  private readonly _max: number;
  private readonly _warnAt: number;

  private _used = 0;
  private _inspectCount = 0;
  private _wastedOnAbort = 0;
  private _statementsTotal = 0;
  private _statementsSinceInspect = 0;
  private _heapMB = 0;
  private _heapMaxMB = 0;
  private _forksActive = 0;
  private _forksCompleted = 0;
  private _contextUsed = 0;
  private _scopeTokens = 0;
  private _sourceTokens = 0;

  constructor(opts: {
    contextWindowTokens: number;
    budgetRatio?: number;
    warnAt?: number;
  }) {
    const ratio = opts.budgetRatio ?? 0.8;
    this._max = Math.floor(opts.contextWindowTokens * ratio);
    this._warnAt = opts.warnAt ?? Math.floor(this._max * 0.9);
  }

  get tokensRemaining(): number {
    return Math.max(0, this._max - this._used);
  }

  get tokensUsed(): number {
    return this._used;
  }

  get inspectCount(): number {
    return this._inspectCount;
  }

  get nearingLimit(): boolean {
    return this._used >= this._warnAt;
  }

  recordTokens(count: number): void {
    this._used += count;
  }

  recordInspect(): void {
    this._inspectCount += 1;
  }

  recordAbortWaste(tokens: number): void {
    this._wastedOnAbort += tokens;
  }

  recordStatement(): void {
    this._statementsTotal += 1;
  }

  recordStatementSinceInspect(): void {
    this._statementsSinceInspect += 1;
  }

  resetStatementsSinceInspect(): void {
    this._statementsSinceInspect = 0;
  }

  setHeap(mb: number, maxMb: number): void {
    this._heapMB = mb;
    this._heapMaxMB = maxMb;
  }

  setForks(active: number, completed: number): void {
    this._forksActive = active;
    this._forksCompleted = completed;
  }

  setContextTokens(used: number, scopeTokens: number, sourceTokens: number): void {
    this._contextUsed = used;
    this._scopeTokens = scopeTokens;
    this._sourceTokens = sourceTokens;
  }

  snapshot(): Budget {
    return {
      tokensRemaining: this.tokensRemaining,
      tokensUsed: this._used,
      inspectCount: this._inspectCount,
      forksActive: this._forksActive,
      forksCompleted: this._forksCompleted,
      nearingLimit: this.nearingLimit,
      context: {
        used: this._contextUsed,
        max: this._max,
        scopeTokens: this._scopeTokens,
        sourceTokens: this._sourceTokens,
        wastedOnAbort: this._wastedOnAbort,
      },
      execution: {
        statementsTotal: this._statementsTotal,
        statementsSinceInspect: this._statementsSinceInspect,
        heapMB: this._heapMB,
        heapMaxMB: this._heapMaxMB,
      },
    };
  }

  createHostFn(): () => Budget {
    return () => this.snapshot();
  }
}
