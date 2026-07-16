import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * The `writeKnowledge` global — a RUNTIME, capability-gated knowledge author.
 *
 * A synthesized space agent that hits a gap in its static knowledge can research the
 * answer and then persist it, so the next question is free. This is the runtime twin of
 * the architect's build-time `writeKnowledgeOption` builder function — but with two
 * deliberate differences that make it safe to hand to an arbitrary agent:
 *
 *   1. **Own-space only, unspoofable.** There is NO `space` parameter. The write root is
 *      closure-bound to the running agent's own `knowledge/` dir (bootstrap passes
 *      `opts.spaceDir + '/knowledge'`, exactly as it does for `loadKnowledge`), so sandbox
 *      code cannot retarget another space's knowledge. The `knowledge:write` capability's
 *      optional `spaces` allow-list (a future cross-space grant) is not honored here yet.
 *   2. **Synchronous host call** (execShell-class, like `db.*`/`scratchWriteRaw`) — writes
 *      are same-process fs, so there is no yield-router entry. Contrast `loadKnowledge`,
 *      which yields because reads are threaded through the router for fork leaves.
 *
 * The file lands at `knowledge/<domain>/<field>/<option>.md`, matching what
 * `loadKnowledge('<domain>','<field>','<option>.md')` reads back. `option: 'index'` is
 * reserved (that is `writeKnowledgeIndex`'s territory). When `opts.source` is given, a
 * one-line provenance blockquote is prepended — this is the signal `reconcile_conflict`
 * reads to rank a stored fact (user-asserted > researched > agent guess).
 */
export function createWriteKnowledgeGlobal(
  knowledgeBaseDir: string,
): (domain: string, field: string, option: string, markdown: string, opts?: { source?: 'user' | 'researched' | 'agent' }) => {
  ok: boolean;
  path: string;
  error?: string;
} {
  return function writeKnowledge(domain, field, option, markdown, opts) {
    if (!domain || !field) return { ok: false, path: '', error: 'writeKnowledge: domain and field are required' };
    const optSlug = String(option ?? '').replace(/\.md$/i, '');
    if (!optSlug) return { ok: false, path: '', error: 'writeKnowledge: option is required' };
    if (optSlug === 'index') {
      return { ok: false, path: '', error: 'writeKnowledge: option "index" is reserved — use the architect to write a field index' };
    }
    if (typeof markdown !== 'string') return { ok: false, path: '', error: 'writeKnowledge: markdown content must be a string' };
    if (!markdown.trim()) return { ok: false, path: '', error: 'writeKnowledge: markdown content is empty — write the actual guidance content, not a blank file' };

    const path = join(knowledgeBaseDir, domain, field, `${optSlug}.md`);
    const body = opts?.source ? `> source: ${provenanceLabel(opts.source)}\n\n${markdown}` : markdown;
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, body, 'utf8');
    } catch (err) {
      return { ok: false, path, error: `writeKnowledge: failed to write ${path}: ${(err as Error).message}` };
    }
    return { ok: true, path };
  };
}

/** Human-readable provenance for the prepended blockquote (also what reconcile_conflict greps). */
function provenanceLabel(source: 'user' | 'researched' | 'agent'): string {
  if (source === 'user') return 'from the user';
  if (source === 'researched') return 'researched';
  return 'the agent';
}
