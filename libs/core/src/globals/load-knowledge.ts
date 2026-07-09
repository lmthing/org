import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { YieldRequest } from '../eval/yield.js';

/**
 * Parse a knowledge file. A knowledge OPTION file is plain markdown (that is what
 * `writeKnowledgeOption` writes), so:
 *   - With YAML frontmatter (`---` … `---`) → `{ frontmatter, body }`.
 *   - Otherwise → the raw markdown text.
 *
 * It deliberately does NOT run a body-less file through a YAML parser. Markdown such
 * as `- **MMLU-Pro**: 75.9` is *almost*-valid YAML: the parser does not throw, it
 * emits noisy `[BAD_ALIAS]` warnings (the `**…**` reads as an alias) and returns a
 * mangled structure instead of the text — silently corrupting the agent's knowledge.
 * `logLevel: 'silent'` keeps even legitimate frontmatter parsing quiet.
 */
export async function loadKnowledgeFile(filePath: string): Promise<unknown> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf8');
  } catch (err) {
    // On-demand loads arrive as `loadKnowledge(domain, field, option)` — the host
    // reconstructs `<knowledge>/<domain>/<field>/<option>` from the OPTION SLUG,
    // which has no extension (the slug is the basename minus `.md`). Fall back to
    // `<path>.md` (the option file) and then `<path>/index.md` (a field/domain
    // overview) before failing, so the slug the prompt hands the agent resolves.
    const fallback = await readWithKnowledgeFallback(filePath);
    if (fallback === undefined) {
      throw new Error(`loadKnowledge(): cannot read "${filePath}": ${(err as Error).message}`);
    }
    content = fallback;
  }

  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (frontmatterMatch) {
    const frontmatterText = frontmatterMatch[1]!;
    const body = frontmatterMatch[2]!.trim();
    let frontmatter: unknown;
    try {
      frontmatter = parseYaml(frontmatterText, { logLevel: 'silent' });
    } catch {
      frontmatter = frontmatterText;
    }
    return { frontmatter, body };
  }

  // No frontmatter → plain markdown body. Return it verbatim (never YAML-parse it).
  return content.trim();
}

/** Try `<path>.md` then `<path>/index.md` for an extension-less knowledge path.
 *  Returns the file content, or undefined when neither exists. Only invoked after a
 *  direct read miss, so a path that already ends in `.md` never reaches here. */
async function readWithKnowledgeFallback(filePath: string): Promise<string | undefined> {
  if (filePath.endsWith('.md')) return undefined;
  for (const candidate of [`${filePath}.md`, join(filePath, 'index.md')]) {
    try {
      return await readFile(candidate, 'utf8');
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}

/**
 * Create the `loadKnowledge` global. Resolves knowledge files from
 * knowledge/<domain>/<field>/<option>.md path segments.
 */
export function createLoadKnowledgeGlobal(
  pushYield: (req: YieldRequest) => void,
  knowledgeBaseDir: string,
): (...path: string[]) => Promise<unknown> {
  return function loadKnowledge(...pathParts: string[]): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      const filePath = join(knowledgeBaseDir, ...pathParts);
      const normalizedPath = pathParts.join('/');

      pushYield({
        kind: 'loadKnowledge',
        args: [normalizedPath],
        deferred: {
          resolve,
          reject,
        },
        vmPromiseHandle: undefined,
      });

      loadKnowledgeFile(filePath).then(resolve, reject);
    });
  };
}
