interface KnowledgeIndexSpec {
  /** Variable name the field binds to at load time, e.g. "piecesKnowledge". */
  variable: string;
  /** Default option slug (without .md). */
  default?: string;
  /** Value type; defaults to "string". */
  type?: string;
  /** Human-readable description (the index.md body). */
  description: string;
}

/**
 * Write a single knowledge field manifest `knowledge/<domain>/<field>/index.md`.
 * The option files (one per loadable variant) are written separately via
 * writeKnowledgeOption. The synthesized agent loads a field at runtime with
 * `loadKnowledge('<domain>', '<field>', '<option>.md')`. Overwrites in place. No imports.
 *
 * @returns { ok, path, error? }
 */
export function writeKnowledgeIndex(
  space: string,
  domain: string,
  field: string,
  spec: KnowledgeIndexSpec,
): { ok: boolean; path: string; error?: string } {
  const dir = resolveSpaceDir(space);
  if (!domain || !field) return { ok: false, path: '', error: 'writeKnowledgeIndex: domain and field are required' };
  if (!spec || typeof spec !== 'object' || !spec.variable) {
    return { ok: false, path: '', error: 'writeKnowledgeIndex: spec.variable is required' };
  }

  const lines = [
    '---',
    `type: ${spec.type ?? 'string'}`,
    `variable: ${spec.variable}`,
    ...(spec.default !== undefined ? [`default: ${String(spec.default).replace(/\.md$/i, '')}`] : []),
    '---',
    '',
    spec.description ?? `${domain} ${field}`,
  ];

  const path = spacePath(dir, 'knowledge', domain, field, 'index.md');
  const w = writeFileRaw(path, lines.join('\n'));
  if (!w.ok) return { ok: false, path, error: `Failed to write ${path}: ${w.error}` };
  return { ok: true, path };
}
