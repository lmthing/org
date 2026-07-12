/** Create or overwrite a file in your scratch sandbox (call createScratch() first).
 *  Binary-safe, no shell quoting. Paths resolve inside the scratch dir. */
export function writeFile(path: string, content: string): { ok: boolean; bytes: number; error?: string } {
  return scratchWriteRaw(path, content);
}
