/** Create or overwrite a file with exact content (binary-safe, no shell quoting). */
export function writeFile(path: string, content: string): { ok: boolean; bytes: number; error?: string } {
  return writeFileRaw(path, content);
}
