export function groupBy(rows: Record<string, string>[], column: string): Record<string, Record<string, string>[]> {
  const groups: Record<string, Record<string, string>[]> = {};
  for (const row of rows) {
    const key = row[column] ?? 'unknown';
    if (!groups[key]) groups[key] = [];
    groups[key]!.push(row);
  }
  return groups;
}
