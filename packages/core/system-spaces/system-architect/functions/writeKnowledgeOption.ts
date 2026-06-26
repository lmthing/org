/** Join path segments with '/'. Replaces node:path.join inside the QuickJS VM. */
function joinPath(...parts: string[]): string {
  return parts
    .map((p, i) => (i === 0 ? p.replace(/\/+$/, '') : p.replace(/^\/+|\/+$/g, '')))
    .filter(Boolean)
    .join('/');
}

/**
 * Write a single knowledge option file `knowledge/<domain>/<field>/<slug>.md`.
 * `content` is plain markdown (no frontmatter). The synthesized agent loads it with
 * `loadKnowledge('<domain>', '<field>', '<slug>.md')`. A stray `.md` on the slug is
 * stripped. Overwrites in place. Uses only writeFileRaw. No imports.
 *
 * @returns { ok, path, error? }
 */
export function writeKnowledgeOption(
  dir: string,
  domain: string,
  field: string,
  slug: string,
  content: string,
): { ok: boolean; path: string; error?: string } {
  if (!domain || !field) return { ok: false, path: '', error: 'writeKnowledgeOption: domain and field are required' };
  const optSlug = String(slug ?? '').replace(/\.md$/i, '');
  if (!optSlug) return { ok: false, path: '', error: 'writeKnowledgeOption: slug is required' };
  if (optSlug === 'index') return { ok: false, path: '', error: 'writeKnowledgeOption: slug "index" is reserved — use writeKnowledgeIndex' };
  if (typeof content !== 'string') return { ok: false, path: '', error: 'writeKnowledgeOption: content must be a string' };

  const path = joinPath(dir, 'knowledge', domain, field, `${optSlug}.md`);
  const w = writeFileRaw(path, content);
  if (!w.ok) return { ok: false, path, error: `Failed to write ${path}: ${w.error}` };
  return { ok: true, path };
}
