import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * An agent's prompt is no longer ONE file. A long `instruct.md` is split so that the
 * always-on body carries the decisions and the one-line rules, while the detail behind
 * each route lives in `knowledge/<domain>/<field>/<aspect>.md` and is pulled in with
 * `loadKnowledge(domain, field, aspect)` at the moment the agent takes that route
 * (`globals/load-knowledge.ts#createLoadKnowledgeGlobal`).
 *
 * A doctrine guard that greps only `instruct.md` therefore stops proving anything the
 * moment its paragraph moves behind a load — it fails even though the doctrine is intact
 * and reachable. These helpers give such a guard the whole CORPUS an agent can read:
 * the instruct body plus every knowledge file in its space.
 *
 * Use {@link agentPromptCorpus} for "this doctrine exists somewhere the agent can reach",
 * and keep asserting on `instruct.md` directly for anything that must be ALWAYS ON — a
 * rule that only holds if the agent already loaded a file is not always on. The two are
 * different claims and the tests should not blur them; `loadPointsIn` closes the gap by
 * proving the instruct actually names the load that reaches a given aspect.
 */

/** Every `.md` file under `dir`, recursively. Returns [] when the directory is absent. */
function markdownFilesUnder(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...markdownFilesUnder(p));
    else if (p.endsWith('.md')) out.push(p);
  }
  return out;
}

/** The full text an agent in `spaceDir` can read: its `instruct.md` body (frontmatter and
 *  all) concatenated with every knowledge file the space ships. */
export function agentPromptCorpus(spaceDir: string, agentSlug: string): string {
  const instruct = readFileSync(join(spaceDir, 'agents', agentSlug, 'instruct.md'), 'utf8');
  const knowledge = markdownFilesUnder(join(spaceDir, 'knowledge')).sort();
  return [instruct, ...knowledge.map((f) => readFileSync(f, 'utf8'))].join('\n\n');
}

/** The `loadKnowledge(domain, field, aspect)` triples an instruct body names, as
 *  `domain/field/aspect` strings. Matches both the call form and the bare-tuple form the
 *  routing table uses (`('playbooks','paths','research')`). */
export function loadPointsIn(instructBody: string): Set<string> {
  const found = new Set<string>();
  const re = /\(\s*'([\w-]+)'\s*,\s*'([\w-]+)'\s*,\s*'([\w-]+)'\s*\)/g;
  for (const m of instructBody.matchAll(re)) found.add(`${m[1]}/${m[2]}/${m[3]}`);
  return found;
}
