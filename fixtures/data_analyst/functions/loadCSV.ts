export function loadCSV(path: string): { headers: string[]; rows: Record<string, string>[]; count: number } {
  const result = execShell(`cat '${path.replace(/'/g, "'\\''")}'`);
  if (!result.ok || !result.stdout.trim()) {
    return { headers: [], rows: [], count: 0 };
  }
  const lines = result.stdout.trim().split('\n');
  const headers = lines[0]!.split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));
  const rows = lines.slice(1).map(line => {
    const values = line.split(',').map(v => v.trim().replace(/^["']|["']$/g, ''));
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i] ?? ''; });
    return row;
  });
  return { headers, rows, count: rows.length };
}

declare function execShell(cmd: string): { ok: boolean; stdout: string; stderr: string };
