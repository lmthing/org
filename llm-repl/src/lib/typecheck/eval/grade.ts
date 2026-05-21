/**
 * Eval grader for lib/typecheck.
 *
 * Primary metric: self-correction rate.
 *   Fraction of type-error traces where the LLM fixes the error within 3 retries.
 *
 * Secondary metrics:
 *   - speculative_correctness: fraction of speculative traces that resolve correctly
 *   - annotation_grace_rate: fraction of grace traces that inject the shape hint
 */
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';

const datasetPath = join(import.meta.dirname, 'dataset.jsonl');

interface DatasetEntry {
  id: string;
  label: string;
  description: string;
  expected: Record<string, unknown>;
}

interface GradeResult {
  id: string;
  label: string;
  pass: boolean;
  score: number;
  reason: string;
}

async function loadDataset(): Promise<DatasetEntry[]> {
  const entries: DatasetEntry[] = [];
  const rl = createInterface({ input: createReadStream(datasetPath) });
  for await (const line of rl) {
    if (line.trim()) entries.push(JSON.parse(line) as DatasetEntry);
  }
  return entries;
}

export async function grade(
  results: Record<string, unknown>[],
): Promise<{ selfCorrectionRate: number; speculativeCorrectness: number; annotationGraceRate: number; perCase: GradeResult[] }> {
  const dataset = await loadDataset();
  const perCase: GradeResult[] = [];

  for (const entry of dataset) {
    const result = results.find((r) => r['id'] === entry.id);
    if (!result) {
      perCase.push({ id: entry.id, label: entry.label, pass: false, score: 0, reason: 'missing result' });
      continue;
    }
    const { pass, score, reason } = scoreEntry(entry, result);
    perCase.push({ id: entry.id, label: entry.label, pass, score, reason });
  }

  const correctionCases = perCase.filter((c) => c.label.startsWith('self-correction'));
  const speculativeCases = perCase.filter((c) => c.label.startsWith('speculative'));
  const graceCases = perCase.filter((c) => c.label.startsWith('annotation-grace'));

  const selfCorrectionRate =
    correctionCases.length > 0
      ? correctionCases.filter((c) => c.pass).length / correctionCases.length
      : 1;

  const speculativeCorrectness =
    speculativeCases.length > 0
      ? speculativeCases.filter((c) => c.pass).length / speculativeCases.length
      : 1;

  const annotationGraceRate =
    graceCases.length > 0
      ? graceCases.filter((c) => c.pass).length / graceCases.length
      : 1;

  return { selfCorrectionRate, speculativeCorrectness, annotationGraceRate, perCase };
}

function scoreEntry(
  entry: DatasetEntry,
  result: Record<string, unknown>,
): { pass: boolean; score: number; reason: string } {
  const exp = entry.expected;

  // For self-correction cases
  if ('self_corrected' in exp) {
    const expectedOk = exp['final_ok'] as boolean;
    const actualOk = result['final_ok'] as boolean;
    if (expectedOk !== actualOk) {
      return { pass: false, score: 0, reason: `expected final_ok=${expectedOk}, got ${actualOk}` };
    }
    return { pass: true, score: 1, reason: 'ok' };
  }

  // For speculative cases
  if ('speculative_result' in exp) {
    const expectedResult = exp['speculative_result'] as string;
    const actualResult = result['speculative_result'] as string;
    if (expectedResult !== actualResult) {
      return { pass: false, score: 0, reason: `expected speculative=${expectedResult}, got ${actualResult}` };
    }
    return { pass: true, score: 1, reason: 'ok' };
  }

  // For annotation grace cases
  if ('grace_applied' in exp) {
    const expectedGrace = exp['grace_applied'] as boolean;
    const actualGrace = result['grace_applied'] as boolean;
    if (expectedGrace !== actualGrace) {
      return { pass: false, score: 0, reason: `expected grace=${expectedGrace}, got ${actualGrace}` };
    }
    return { pass: true, score: 1, reason: 'ok' };
  }

  // For inferred binding cases
  if ('inferred_binding' in exp) {
    const expBinding = exp['inferred_binding'] as { name: string; type_contains: string };
    const bindings = result['inferred_bindings'] as Array<{ name: string; type: string }> | undefined;
    const found = bindings?.find((b) => b.name === expBinding.name);
    if (!found) return { pass: false, score: 0, reason: `no binding named ${expBinding.name}` };
    if (!found.type.includes(expBinding.type_contains)) {
      return { pass: false, score: 0, reason: `type "${found.type}" does not contain "${expBinding.type_contains}"` };
    }
    return { pass: true, score: 1, reason: 'ok' };
  }

  return { pass: true, score: 1, reason: 'no assertions' };
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const resultsPath = process.argv[2];
  if (!resultsPath) {
    console.error('Usage: grade.ts <results.jsonl>');
    process.exit(1);
  }

  const { createReadStream: crs } = await import('node:fs');
  const { createInterface: ci } = await import('node:readline');
  const results: Record<string, unknown>[] = [];
  const rl2 = ci({ input: crs(resultsPath) });
  for await (const line of rl2) {
    if (line.trim()) results.push(JSON.parse(line));
  }

  const summary = await grade(results);
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nSelf-correction rate:       ${(summary.selfCorrectionRate * 100).toFixed(1)}%`);
  console.log(`Speculative correctness:    ${(summary.speculativeCorrectness * 100).toFixed(1)}%`);
  console.log(`Annotation grace rate:      ${(summary.annotationGraceRate * 100).toFixed(1)}%`);
}
