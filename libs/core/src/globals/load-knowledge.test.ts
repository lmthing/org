import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadKnowledgeFile, createLoadKnowledgeGlobal, normalizeLoadKnowledgeArgs } from './load-knowledge.js';
import type { YieldRequest } from '../eval/yield.js';
import { Session } from '../session/session.js';
import { createMockStreamFn } from '../testing/mock-provider.js';
import type { StreamOpts } from '../eval/stream-types.js';
import type { RenderHost } from '../session/types.js';

describe('loadKnowledgeFile', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'kn-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

  it('returns a body-less markdown option file VERBATIM (no YAML mangling)', async () => {
    // This exact content used to be parsed as YAML: `- **MMLU-Pro**: 75.9` reads as an
    // ambiguous alias, emitting [BAD_ALIAS] warnings and returning garbage instead of text.
    const md = [
      '# Benchmarks',
      '',
      '- **MMLU-Pro**: 75.9 (vs Claude 3.5 Sonnet 78.0)',
      '- **MATH-500**: 90.2 (vs GPT-4o 74.6)',
    ].join('\n');
    const p = join(dir, 'overview.md');
    writeFileSync(p, md, 'utf8');
    const out = await loadKnowledgeFile(p);
    expect(typeof out).toBe('string');
    expect(out).toBe(md.trim());
    expect(out as string).toContain('**MMLU-Pro**: 75.9');
  });

  it('splits frontmatter + body when present', async () => {
    const p = join(dir, 'index.md');
    writeFileSync(p, '---\nvariable: foo\ndefault: overview\n---\n\nHello body.', 'utf8');
    const out = await loadKnowledgeFile(p) as { frontmatter: { variable: string }; body: string };
    expect(out.frontmatter.variable).toBe('foo');
    expect(out.body).toBe('Hello body.');
  });

  // On-demand loads arrive as `loadKnowledge(domain, field, option)`; the host
  // reconstructs the path from the OPTION SLUG, which has no extension. The resolver
  // must fall back to `<path>.md` (option file) then `<path>/index.md` (field/domain).
  it('resolves an extension-less option path to <path>.md', async () => {
    writeFileSync(join(dir, 'word.md'), '---\ndescription: Word docs.\n---\n\n# Word body', 'utf8');
    const out = await loadKnowledgeFile(join(dir, 'word')) as { frontmatter: { description: string }; body: string };
    expect(out.frontmatter.description).toBe('Word docs.');
    expect(out.body).toContain('# Word body');
  });

  it('resolves an extension-less field path to <path>/index.md', async () => {
    const { mkdirSync } = await import('node:fs');
    const fieldDir = join(dir, 'formats');
    mkdirSync(fieldDir, { recursive: true });
    writeFileSync(join(fieldDir, 'index.md'), '---\nvariable: fmt\n---\n\nField overview.', 'utf8');
    const out = await loadKnowledgeFile(fieldDir) as { frontmatter: { variable: string }; body: string };
    expect(out.frontmatter.variable).toBe('fmt');
    expect(out.body).toBe('Field overview.');
  });

  // A domain/field MENU load (`loadKnowledge(domain, field)` → `<field>/index.md`) is
  // augmented with the REAL option slugs on disk, in full, so the model never guesses an
  // option name the hand-written menu forgot to list (or that no longer exists).
  it('a domain/field menu (index.md) load appends the real option list from disk, in full', async () => {
    const fieldDir = join(dir, 'split');
    mkdirSync(fieldDir, { recursive: true });
    writeFileSync(join(fieldDir, 'index.md'), '# Split guide\n\nPick a domain.', 'utf8');
    writeFileSync(join(fieldDir, 'trips.md'), 'Trips.', 'utf8');
    writeFileSync(join(fieldDir, 'pets.md'), 'Pets.', 'utf8');
    writeFileSync(join(fieldDir, 'default.md'), 'Default.', 'utf8');
    const out = await loadKnowledgeFile(fieldDir);
    expect(typeof out).toBe('string');
    const text = out as string;
    expect(text).toContain('Pick a domain.');           // the index body, in full
    expect(text).toContain('- default');                // real slugs, sorted, index excluded
    expect(text).toContain('- pets');
    expect(text).toContain('- trips');
    expect(text).not.toContain('- index');
  });

  it('a direct option file load is returned verbatim — NOT augmented with a sibling option list', async () => {
    const fieldDir = join(dir, 'split2');
    mkdirSync(fieldDir, { recursive: true });
    writeFileSync(join(fieldDir, 'trips.md'), 'Trips split guide.', 'utf8');
    writeFileSync(join(fieldDir, 'pets.md'), 'Pets split guide.', 'utf8');
    const out = await loadKnowledgeFile(join(fieldDir, 'trips'));
    expect(out).toBe('Trips split guide.'); // exact — no option list appended to an option file
  });

  it('still throws for a path that resolves to nothing', async () => {
    await expect(loadKnowledgeFile(join(dir, 'nope'))).rejects.toThrow(/cannot read/);
  });
});

describe('createLoadKnowledgeGlobal (multi-dir fallback)', () => {
  let ownDir: string;
  let systemDir: string;
  const pushYield = (_req: YieldRequest): void => {};

  beforeEach(() => {
    ownDir = mkdtempSync(join(tmpdir(), 'kn-own-'));
    systemDir = mkdtempSync(join(tmpdir(), 'kn-system-'));
  });
  afterEach(() => {
    rmSync(ownDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    rmSync(systemDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  // Reproduces the real bug: an agent's OWN runtime spaceDir (a project directory)
  // has no knowledge of its own for a domain that only physically exists in a
  // MERGED-IN system space (e.g. THING's own `organize_material` consulting
  // user-thing's `organizing/split` library) — the fix is trying every candidate
  // base dir, not just the first.
  it('falls back to a later base dir when the domain is absent from the first', async () => {
    mkdirSync(join(systemDir, 'organizing', 'split'), { recursive: true });
    writeFileSync(join(systemDir, 'organizing', 'split', 'household.md'), 'Household split guide.', 'utf8');

    const loadKnowledge = createLoadKnowledgeGlobal(pushYield, [ownDir, systemDir]);
    const result = await loadKnowledge('organizing', 'split', 'household');
    expect(result).toBe('Household split guide.');
  });

  it('prefers the FIRST dir when both have the same domain (own space can override/shadow)', async () => {
    mkdirSync(join(ownDir, 'organizing', 'split'), { recursive: true });
    writeFileSync(join(ownDir, 'organizing', 'split', 'household.md'), 'Project override.', 'utf8');
    mkdirSync(join(systemDir, 'organizing', 'split'), { recursive: true });
    writeFileSync(join(systemDir, 'organizing', 'split', 'household.md'), 'System default.', 'utf8');

    const loadKnowledge = createLoadKnowledgeGlobal(pushYield, [ownDir, systemDir]);
    const result = await loadKnowledge('organizing', 'split', 'household');
    expect(result).toBe('Project override.');
  });

  it('throws naming every directory it tried when NO candidate has the domain', async () => {
    const loadKnowledge = createLoadKnowledgeGlobal(pushYield, [ownDir, systemDir]);
    await expect(loadKnowledge('organizing', 'split', 'nope')).rejects.toThrow(/tried:/);
  });
});

/**
 * A load costs a TURN. So an agent that needs three aspects to act correctly is, with a one-per-call
 * global, choosing between three turns and acting on one aspect — and it will pick the second.
 * Passing one ARRAY per aspect resolves them together for the cost of a single load, which is what
 * makes "load the aspects that match what you just decided" advice an agent can actually follow.
 */
describe('createLoadKnowledgeGlobal (several aspects, ONE load)', () => {
  let dir: string;
  const yields: YieldRequest[] = [];
  const pushYield = (req: YieldRequest): void => { yields.push(req); };

  beforeEach(() => {
    yields.length = 0;
    dir = mkdtempSync(join(tmpdir(), 'kn-multi-'));
    mkdirSync(join(dir, 'playbooks', 'paths'), { recursive: true });
    mkdirSync(join(dir, 'playbooks', 'building'), { recursive: true });
    writeFileSync(join(dir, 'playbooks', 'paths', 'application.md'), 'APP.', 'utf8');
    writeFileSync(join(dir, 'playbooks', 'building', 'create-project.md'), 'PROJECT.', 'utf8');
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

  it('resolves an array-per-aspect call to results in the SAME order', async () => {
    const loadKnowledge = createLoadKnowledgeGlobal(pushYield, [dir]);
    const result = await loadKnowledge(
      ['playbooks', 'paths', 'application'],
      ['playbooks', 'building', 'create-project'],
    );
    // Positional, so a destructuring bind in the prompt's own example lines up.
    expect(result).toEqual(['APP.', 'PROJECT.']);
  });

  it('spends ONE yield for the whole batch — the turn cost is what is being saved', async () => {
    const loadKnowledge = createLoadKnowledgeGlobal(pushYield, [dir]);
    await loadKnowledge(['playbooks', 'paths', 'application'], ['playbooks', 'building', 'create-project']);
    expect(yields).toHaveLength(1);
    expect(yields[0]!.args).toEqual(['playbooks/paths/application', 'playbooks/building/create-project']);
  });

  it('accepts slash-joined paths as the same multi form', async () => {
    const loadKnowledge = createLoadKnowledgeGlobal(pushYield, [dir]);
    expect(await loadKnowledge('playbooks/paths/application', 'playbooks/building/create-project'))
      .toEqual(['APP.', 'PROJECT.']);
  });

  /**
   * The CALL SHAPE decides the RESULT SHAPE. A single array returns a ONE-ELEMENT ARRAY, not the
   * bare value — because the alternative (unwrap when there happens to be one) means adding a
   * second aspect silently turns a value into an array, breaking a working call at exactly the
   * moment the agent needs one more file. That edit is the one this API exists to make cheap.
   */
  it('a SINGLE array returns a one-element array, so adding a second aspect changes nothing', async () => {
    const loadKnowledge = createLoadKnowledgeGlobal(pushYield, [dir]);
    const [one] = await loadKnowledge(['playbooks', 'paths', 'application']) as string[];
    expect(one).toBe('APP.');
    const [a, b] = await loadKnowledge(
      ['playbooks', 'paths', 'application'],
      ['playbooks', 'building', 'create-project'],
    ) as string[];
    expect([a, b]).toEqual(['APP.', 'PROJECT.']);
  });

  /**
   * The whole point of the array form is that it is ADDITIVE. Every shipped prompt, and every
   * specialist the architect synthesizes, emits the bare-string form — including the 2-part MENU
   * load, which must keep meaning "one path, no option" and not "two paths".
   */
  it('leaves the long-standing bare-string forms meaning exactly what they meant', () => {
    expect(normalizeLoadKnowledgeArgs(['playbooks', 'paths', 'research'])).toEqual([['playbooks', 'paths', 'research']]);
    expect(normalizeLoadKnowledgeArgs(['documents', 'formats'])).toEqual([['documents', 'formats']]);
    expect(normalizeLoadKnowledgeArgs(['organizing'])).toEqual([['organizing']]);
  });

  it('rejects the whole batch when ONE aspect is missing, naming what it tried', async () => {
    const loadKnowledge = createLoadKnowledgeGlobal(pushYield, [dir]);
    await expect(
      loadKnowledge(['playbooks', 'paths', 'application'], ['playbooks', 'paths', 'nope']),
    ).rejects.toThrow(/tried:/);
  });
});

describe('loadKnowledge through a Session fork (end-to-end wiring regression)', () => {
  // This reproduces the real failure THING hit in every "organize a pile of files"
  // run: the top-level agent's session `spaceDir` is a PROJECT directory with no
  // knowledge of its own; the system space that DEFINES the agent (e.g. user-thing)
  // carries the actual knowledge library, merged in via mergeSystemInto. A fork
  // (like a task node inside `organize_material`) inherits the PARENT's spaceDir
  // (fork.ts `parentSpaceDir`) — before the fix, its loadKnowledge() had no way to
  // reach the system space's knowledge dir at all and ENOENTed on every call, so
  // organize_material always silently fell back to a generic default guide. This
  // test drives the actual Session → fork() → loadKnowledge() path (not just the
  // primitive in isolation above) to prove the wiring, not just the resolver, is
  // fixed — the field the fork/session/delegate construction sites must all pass.
  it('a fork inheriting the parent PROJECT spaceDir still reaches a domain that only exists in a merged SYSTEM space', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'kn-e2e-project-'));
    const sysDir = mkdtempSync(join(tmpdir(), 'kn-e2e-system-'));
    try {
      mkdirSync(join(projectDir, 'agents', 'main'), { recursive: true });
      writeFileSync(join(projectDir, 'agents', 'main', 'instruct.md'), 'Test agent.\n', 'utf8');
      // The project itself has NO knowledge/ dir at all — matching the real
      // `.lmthing/<project>` layout, which never carries user-thing's own library.
      mkdirSync(join(sysDir, 'knowledge', 'organizing', 'split'), { recursive: true });
      writeFileSync(
        join(sysDir, 'knowledge', 'organizing', 'split', 'household.md'),
        'System household split guide.',
        'utf8',
      );

      let forked = false;
      let forkStatementsIssued = 0;
      const displays: unknown[] = [];
      const logs: string[] = [];
      const streamFn = createMockStreamFn((opts: StreamOpts) => {
        // Match the fork's OWN user message specifically: it carries BOTH the
        // instruction AND "Output schema" (fork.ts's userMessage template) — the
        // session's OWN turns never have both together, which is what a looser
        // "LOAD_TEST" substring match (system prompt, or full history) wrongly hit.
        const isForkTurn = opts.messages.some((m) => String(m.content).includes('LOAD_TEST') && String(m.content).includes('Output schema'));
        if (isForkTurn) {
          // Two SEPARATE statements — `await loadKnowledge(...)` yields on its own
          // (turn ends there); `currentTask.resolve` must be a LATER turn once `k`
          // comes back bound, or the fork just re-issues the same yield forever.
          forkStatementsIssued++;
          if (forkStatementsIssued === 1) {
            return `const k = await loadKnowledge('organizing', 'split', 'household');`;
          }
          return `currentTask.resolve({ text: String(k) });`;
        }
        if (!forked) {
          forked = true;
          return `const f = await fork({ role: 'general', instruction: 'LOAD_TEST', output: { text: 'string' } });`;
        }
        return `display(String((f as { text: string }).text));`;
      });

      const host: RenderHost = {
        display: (d) => displays.push(d),
        ask: async () => undefined,
        log: (msg: string) => logs.push(msg),
      };
      const session = new Session(
        {
          spaceDir: projectDir,
          agentSlug: 'main',
          modelAlias: 'mock',
          renderHost: host,
          systemSpaceDirs: [sysDir],
        },
        { streamFn },
      );
      await session.start('go');
      await session.dispose();

      expect(displays, `logs:\n${logs.join('\n')}`).toContain('System household split guide.');
    } finally {
      rmSync(projectDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      rmSync(sysDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});
