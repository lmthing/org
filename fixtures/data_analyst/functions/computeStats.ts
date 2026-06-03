export function computeStats(values: number[]): {
  count: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  stddev: number;
} {
  if (values.length === 0) return { count: 0, mean: 0, median: 0, min: 0, max: 0, stddev: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const count = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / count;
  const median = count % 2 === 0
    ? (sorted[count / 2 - 1]! + sorted[count / 2]!) / 2
    : sorted[Math.floor(count / 2)]!;
  const min = sorted[0]!;
  const max = sorted[sorted.length - 1]!;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / count;
  const stddev = Math.sqrt(variance);
  return { count, mean: Math.round(mean * 100) / 100, median, min, max, stddev: Math.round(stddev * 100) / 100 };
}
