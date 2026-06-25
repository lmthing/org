import { readFile } from 'node:fs/promises';
import type { Space } from './load.js';
import { parseFrontmatter } from './frontmatter.js';
import { validateKnowledgeOptionFrontmatter } from './load.js';

/**
 * Resolve a knowledge path to a value.
 * path: [domain] | [domain, field] | [domain, field, option]
 */
export async function resolveKnowledge(space: Space, path: string[]): Promise<unknown> {
  const [domainSlug, fieldSlug, optionSlug] = path;

  if (!domainSlug) {
    // Return overview of all domains
    return Object.keys(space.knowledge.domains);
  }

  const domain = space.knowledge.domains[domainSlug];
  if (!domain) {
    throw new Error(`Knowledge domain "${domainSlug}" not found`);
  }

  if (!fieldSlug) {
    // Return field overview for the domain
    return Object.fromEntries(
      Object.entries(domain.fields).map(([k, v]) => [k, { type: v.type, options: Object.keys(v.options) }]),
    );
  }

  const field = domain.fields[fieldSlug];
  if (!field) {
    throw new Error(`Knowledge field "${fieldSlug}" not found in domain "${domainSlug}"`);
  }

  if (!optionSlug) {
    // Return field metadata
    return {
      type: field.type,
      variableName: field.variableName,
      default: field.default,
      options: Object.keys(field.options),
    };
  }

  const filePath = field.options[optionSlug];
  if (!filePath) {
    throw new Error(
      `Knowledge option "${optionSlug}" not found in field "${fieldSlug}" of domain "${domainSlug}"`,
    );
  }

  const content = await readFile(filePath, 'utf8');
  validateKnowledgeOptionFrontmatter(content, filePath);
  const { data, body } = parseFrontmatter(content, filePath);

  // If there's frontmatter data, return structured object
  if (Object.keys(data).length > 0) {
    return { ...data, body: body || undefined };
  }

  return body || content.trim();
}
