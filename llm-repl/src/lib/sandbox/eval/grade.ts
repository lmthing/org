/**
 * Sandbox eval grader.
 * Full eval wiring happens after L2 when inspect() exists.
 */

interface GradeOptions {
  lib: unknown;
  model: unknown;
  modelId: string;
}

export async function run(options: GradeOptions): Promise<void> {
  console.log('sandbox eval not yet wired to real sessions');
  console.log(`modelId: ${options.modelId}`);
  process.exit(0);
}
