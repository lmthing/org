export { runTsc } from './tsc-runner.js';
export type { TscResult, TscDiagnostic, InferredBinding, TscRunnerOptions } from './tsc-runner.js';

export { runTscWithRetry } from './retry.js';
export type { RetryResult } from './retry.js';

export { SpeculativeBuffer, extractAwaitAnnotation, hasTopLevelAwait } from './speculative.js';
export type {
  BufferedStatement,
  SpeculativeOk,
  SpeculativeMismatch,
  SpeculativeOverflow,
  SpeculativeFlushResult,
  SpeculativeConfig,
} from './speculative.js';

export { AnnotationGrace, deriveTypeShape, buildGraceHint } from './annotation-grace.js';
export type { GraceCheckResult } from './annotation-grace.js';
