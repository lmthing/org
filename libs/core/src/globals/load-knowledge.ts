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
  const content = await resolveKnowledgeContent(filePath);
  if (content === undefined) {
    throw new Error(`loadKnowledge(): cannot read "${filePath}"`);
  }
  return parseKnowledgeContent(content);
}

/** Read a knowledge file's raw text, with the extension-less fallback (below).
 *  Returns `undefined` (never throws) when nothing resolves — the caller decides
 *  whether that is fatal (a single base dir) or just "try the next candidate"
 *  (`loadKnowledgeFileFromDirs`, multiple base dirs). */
async function resolveKnowledgeContent(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    // On-demand loads arrive as `loadKnowledge(domain, field, option)` — the host
    // reconstructs `<knowledge>/<domain>/<field>/<option>` from the OPTION SLUG,
    // which has no extension (the slug is the basename minus `.md`). Fall back to
    // `<path>.md` (the option file) and then `<path>/index.md` (a field/domain
    // overview) before failing, so the slug the prompt hands the agent resolves.
    return readWithKnowledgeFallback(filePath);
  }
}

/** Split a knowledge file's raw text into `{ frontmatter, body }` when it has
 *  YAML frontmatter, else return the plain markdown text verbatim (see the
 *  module doc comment on why a body-less file is never run through the YAML
 *  parser). */
function parseKnowledgeContent(content: string): unknown {
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

/**
 * Resolve `<domain>/<field>/<option>` against MULTIPLE candidate knowledge base
 * directories, in priority order, returning the first that resolves.
 *
 * Why this exists: a session's own space is a MERGE of the project's own files
 * with every dependent/system space (`mergeSystemInto` — the in-memory
 * `Space.knowledge.domains` already reflects this, which is what a DECLARATIVE
 * `knowledge:` frontmatter preload reads). But the ON-DEMAND `loadKnowledge()`
 * global reads lazily from DISK by a plain path, and used to know only ONE base
 * dir (`<spaceDir>/knowledge`) — the project's own directory. A domain that only
 * physically exists in a MERGED-IN system space (e.g. `user-thing`'s
 * `organizing/split` library, consulted by every `organize_material` run) was
 * therefore UNREACHABLE on demand: every lookup ENOENTed and silently fell back
 * to whatever default the caller's own prose improvised, even though the file is
 * right there on disk — just under a different space's directory. Trying each
 * candidate directory (own space first, so a project can still override/shadow
 * a system domain by authoring its own copy) fixes this without changing what a
 * project-authored knowledge file resolves to.
 */
export async function loadKnowledgeFileFromDirs(baseDirs: string[], pathParts: string[]): Promise<unknown> {
  const tried: string[] = [];
  for (const baseDir of baseDirs) {
    const filePath = join(baseDir, ...pathParts);
    tried.push(filePath);
    const content = await resolveKnowledgeContent(filePath);
    if (content !== undefined) return parseKnowledgeContent(content);
  }
  throw new Error(`loadKnowledge(): cannot read "${pathParts.join('/')}" — tried: ${tried.join(', ')}`);
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
 *
 * `knowledgeBaseDirs` is searched IN ORDER — the running space's own directory
 * first (so it can shadow/override), then any fallback directories (each merged
 * system space's own `knowledge/` dir) — see `loadKnowledgeFileFromDirs`.
 */
export function createLoadKnowledgeGlobal(
  pushYield: (req: YieldRequest) => void,
  knowledgeBaseDirs: string[],
): (...path: string[]) => Promise<unknown> {
  return function loadKnowledge(...pathParts: string[]): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
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

      loadKnowledgeFileFromDirs(knowledgeBaseDirs, pathParts).then(resolve, reject);
    });
  };
}
