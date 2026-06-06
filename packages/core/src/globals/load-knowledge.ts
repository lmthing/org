import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { YieldRequest } from '../eval/yield.js';

/**
 * Parse a knowledge file: strip YAML frontmatter, return structured value or
 * { frontmatter, body } object.
 */
export async function loadKnowledgeFile(filePath: string): Promise<unknown> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf8');
  } catch (err) {
    throw new Error(`loadKnowledge(): cannot read "${filePath}": ${(err as Error).message}`);
  }

  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (frontmatterMatch) {
    const frontmatterText = frontmatterMatch[1]!;
    const body = frontmatterMatch[2]!.trim();
    let frontmatter: unknown;
    try {
      frontmatter = parseYaml(frontmatterText);
    } catch {
      frontmatter = frontmatterText;
    }
    return { frontmatter, body };
  }

  // Try to parse as pure YAML
  try {
    return parseYaml(content);
  } catch {
    // Return raw text
    return content.trim();
  }
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
