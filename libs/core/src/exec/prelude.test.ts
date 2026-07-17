import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, type Server } from 'node:http';
import { ForkEngine } from '../fork/fork.js';
import { runTasklist } from '../tasklist/orchestrator.js';
import { loadTasklist } from '../spaces/tasklist-load.js';
import { loadSpace } from '../spaces/load.js';
import { createMockStreamFn } from '../testing/mock-provider.js';
import { Tracer, type TraceEvent } from '../sandbox/trace.js';
import { splitPreludeStatements } from './prelude.js';
import type { RenderHost } from '../session/types.js';
import type { StreamOpts } from '../eval/stream-types.js';

/**
 * Phase 4 — `prelude:` host-executed leaf statements (fixes root cause A3 of
 * `.issues/investigate-forks-degrade-under-delegate-nesting.md`): the task's
 * deterministic setup statements run in the fork VM with HOST reliability
 * before the model's first turn, instead of being re-emitted (and skipped/
 * renamed/reordered) by a small model across yield turn boundaries.
 */

const silentHost: RenderHost = { display: () => {}, ask: async () => undefined, log: () => {} };

const tmpDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

describe('splitPreludeStatements', () => {
  it('splits trusted source into top-level statements via a single TS parse', () => {
    const stmts = splitPreludeStatements(
      '// setup\nconst a = 1;\nconst r = await fetch("http://x/", {\n  method: "GET",\n});\nconst [x, y] = [a, a];',
    );
    expect(stmts).toEqual([
      'const a = 1;',
      'const r = await fetch("http://x/", {\n  method: "GET",\n});',
      'const [x, y] = [a, a];',
    ]);
  });

  it('returns [] for empty/whitespace source', () => {
    expect(splitPreludeStatements('')).toEqual([]);
    expect(splitPreludeStatements('  \n ')).toEqual([]);
  });
});

describe('fork prelude', () => {
  it('binds plain statements before the first model turn; the model reads them (and episodes are NOT ticked)', async () => {
    const prompts: string[] = [];
    const events: TraceEvent[] = [];
    const tracer = new Tracer(null);
    tracer.subscribe((e) => events.push(e));

    const engine = new ForkEngine({
      maxConcurrentForks: 2,
      parentHistory: [],
      parentSpaceDir: '/tmp',
      parentAgentSlug: 'test',
      renderHost: silentHost,
      tracer,
      streamFn: createMockStreamFn((o: StreamOpts) => {
        prompts.push(o.messages.map((m) => m.content).join('\n---\n'));
        // The model's single statement references the prelude's `b` — it must
        // typecheck against the prelude-seeded initialContext.
        return 'currentTask.resolve({ b, episodes: progress().episodes });';
      }),
    });

    const result = await engine.fork<{ b: number; episodes: number }>({
      instruction: 'read the prelude results',
      output: { b: 'number', episodes: 'number' },
      prelude: 'const a = 1;\nconst b = a + 1;',
    });

    expect(result.b).toBe(2);
    // Prelude statements do NOT count as episodes: the model's first turn is episode 1.
    expect(result.episodes).toBe(1);

    // The prelude's VARIABLES block is in the FIRST prompt the model sees, with values.
    expect(prompts[0]).toContain('PRELUDE');
    expect(prompts[0]).toContain('VARIABLES');
    expect(prompts[0]).toContain('b: 2');
    expect(prompts[0]).toContain('const b = a + 1;'); // ALREADY EXECUTED section

    // Trace events for prelude statements carry a `:prelude` context label.
    const preludeStmts = events.filter((e) => e.type === 'statement' && e.context.endsWith(':prelude'));
    expect(preludeStmts.length).toBe(2);
  });

  it('surfaces a full document read during the prelude in the model’s first prompt', async () => {
    const prompts: string[] = [];
    const longText = 'source '.repeat(1000) + 'UNIQUE_DOCUMENT_TAIL';
    const engine = new ForkEngine({
      maxConcurrentForks: 2,
      parentHistory: [],
      parentSpaceDir: '/tmp',
      parentAgentSlug: 'test',
      renderHost: silentHost,
      streamFn: createMockStreamFn((o: StreamOpts) => {
        prompts.push(o.messages.map((m) => m.content).join('\n---\n'));
        return 'currentTask.resolve({ ok: true });';
      }),
      documentResolver: async (attachmentId) => ({
        ok: true, attachmentId, mediaType: 'text/plain', filename: 'source.txt', kind: 'text', text: longText,
      }),
    });

    await engine.fork<{ ok: boolean }>({
      instruction: 'summarize the source',
      output: { ok: 'boolean' },
      prelude: "const source = await readDocument('source-1');",
    });

    // The DOCUMENT CONTENTS block carries the FULL text (not the truncated variable preview).
    expect(prompts[0]).toContain('DOCUMENT CONTENTS');
    const docBlock = prompts[0].slice(prompts[0].indexOf('DOCUMENT CONTENTS'));
    expect(docBlock).toContain('UNIQUE_DOCUMENT_TAIL'); // the full tail reached the block
    expect(docBlock).not.toContain('chars total'); // the block itself is not the truncated preview
  });

  it('resolves a YIELDING prelude statement (loadKnowledge) through the fork yield router and ticks the tool-call budget', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'prelude-lk-'));
    tmpDirs.push(dir);
    const knowledgeDir = join(dir, 'knowledge', 'domain', 'field');
    await mkdir(knowledgeDir, { recursive: true });
    await writeFile(join(knowledgeDir, 'opt.md'), '---\nvariable: x\n---\n\nHello knowledge', 'utf8');

    const events: TraceEvent[] = [];
    const tracer = new Tracer(null);
    tracer.subscribe((e) => events.push(e));

    const engine = new ForkEngine({
      maxConcurrentForks: 2,
      parentHistory: [],
      parentSpaceDir: dir,
      parentAgentSlug: 'test',
      renderHost: silentHost,
      tracer,
      streamFn: createMockStreamFn(() =>
        'currentTask.resolve({ body: (k as any).body, toolCalls: progress().toolCalls });',
      ),
    });

    const result = await engine.fork<{ body: string; toolCalls: number }>({
      instruction: 'use the pre-loaded knowledge',
      output: { body: 'string', toolCalls: 'number' },
      prelude: "const k = await loadKnowledge('domain', 'field', 'opt.md');",
    });

    expect(result.body).toBe('Hello knowledge');
    // The prelude's yield ticked the fork's Budget toolCall counter.
    expect(result.toolCalls).toBeGreaterThanOrEqual(1);

    // yield/yield_resolved trace events fired for the prelude yield.
    const preludeYields = events.filter((e) => e.type === 'yield' && e.context.endsWith(':prelude'));
    const preludeResolved = events.filter((e) => e.type === 'yield_resolved' && e.context.endsWith(':prelude'));
    expect(preludeYields.length).toBe(1);
    expect(preludeResolved.length).toBe(1);
  });

  it('binds a NESTED yield (space function internally awaiting fetch) via bindYieldResults\' getVar preference', async () => {
    // `fetcher` mirrors webSearch/webFetch: a space function whose own awaited
    // fetch() is the actual yield. Binding the raw resolved value would bind the
    // inner fetch response (no `tag`); the getVar preference recovers fetcher's
    // real processed return — the load-bearing nested-yield fix reused from the
    // exported turn-loop helper.
    const server: Server = createServer((_req, res) => res.end('ok'));
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    try {
      const fetcherSrc = [
        'export async function fetcher(q: string): Promise<{ tag: string; status: number }> {',
        `  const r = await fetch('http://127.0.0.1:${port}/?q=' + encodeURIComponent(q));`,
        '  return { tag: `processed:${q}`, status: r.status };',
        '}',
      ].join('\n');

      const engine = new ForkEngine({
        maxConcurrentForks: 2,
        parentHistory: [],
        parentSpaceDir: '/tmp',
        parentAgentSlug: 'test',
        renderHost: silentHost,
        agentFunctions: { fetcher: fetcherSrc },
        streamFn: createMockStreamFn(() =>
          'currentTask.resolve({ question, tag: r.tag, status: r.status });',
        ),
      });

      const result = await engine.fork<{ question: string; tag: string; status: number }>({
        instruction: 'report the pre-fetched result',
        output: { question: 'string', tag: 'string', status: 'number' },
        seed: { q: 'q1' },
        prelude: 'const question = String(q);\nconst r = await fetcher(question);',
      });

      expect(result.question).toBe('q1');
      expect(result.tag).toBe('processed:q1'); // fetcher's OWN return, not the raw fetch response
      expect(result.status).toBe(200);
    } finally {
      server.close();
    }
  });

  it('a failing prelude statement degrades (names bound undefined, noted in VARIABLES) and later statements still run', async () => {
    const prompts: string[] = [];
    const engine = new ForkEngine({
      maxConcurrentForks: 2,
      parentHistory: [],
      parentSpaceDir: '/tmp',
      parentAgentSlug: 'test',
      renderHost: silentHost,
      streamFn: createMockStreamFn((o: StreamOpts) => {
        prompts.push(o.messages.map((m) => m.content).join('\n---\n'));
        // References BOTH the failed name (`b`, ambient any) and the later
        // successful statement's `c` — both must typecheck.
        return 'currentTask.resolve({ a, c, bUndefined: b === undefined });';
      }),
    });

    const result = await engine.fork<{ a: number; c: number; bUndefined: boolean }>({
      instruction: 'work with what survived',
      output: { a: 'number', c: 'number', bUndefined: 'boolean' },
      prelude: [
        'const a = 1;',
        'const b: any = JSON.parse("{nope");', // typechecks, THROWS at eval
        'const c = a + 1;',
      ].join('\n'),
    });

    // Statement 2 failed; statements 1 and 3 still executed.
    expect(result.a).toBe(1);
    expect(result.c).toBe(2);
    expect(result.bUndefined).toBe(true);

    // The VARIABLES block notes the failure with the statement index.
    expect(prompts[0]).toMatch(/\/\/ prelude: statement 2 failed:/);
    expect(prompts[0]).toContain('c: 2');
  });

  it('treats currentTask.resolve() in a prelude as a prelude error — resolving stays the model\'s job', async () => {
    const prompts: string[] = [];
    const engine = new ForkEngine({
      maxConcurrentForks: 2,
      parentHistory: [],
      parentSpaceDir: '/tmp',
      parentAgentSlug: 'test',
      renderHost: silentHost,
      streamFn: createMockStreamFn((o: StreamOpts) => {
        prompts.push(o.messages.map((m) => m.content).join('\n---\n'));
        return 'currentTask.resolve({ x: "real" });';
      }),
    });

    const result = await engine.fork<{ x: string }>({
      instruction: 'resolve normally',
      output: { x: 'string' },
      prelude: 'currentTask.resolve({ x: "hax" });\nconst ok = true;',
    });

    // The prelude did NOT pre-resolve; the model's value won.
    expect(result.x).toBe('real');
    // `currentTask` is not declared in the prelude's ambient → typecheck failure, noted.
    expect(prompts[0]).toMatch(/\/\/ prelude: statement 1 failed:.*currentTask/);
  });
});

describe('forEach + prelude (tasklist)', () => {
  it('runs the prelude per element with the correct `item` seed var', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'prelude-foreach-'));
    tmpDirs.push(dir);
    await mkdir(join(dir, 'agents', 'researcher'), { recursive: true });
    await writeFile(join(dir, 'agents', 'researcher', 'instruct.md'), 'You are a researcher.\n', 'utf8');

    const tl = join(dir, 'tasklists', 'per_item');
    await mkdir(tl, { recursive: true });
    await writeFile(join(tl, 'index.md'), '---\ninput:\n  query: string\n---\n\nGOAL: per-item prelude.', 'utf8');
    await writeFile(
      join(tl, '01-plan.md'),
      '---\nid: plan\noutput:\n  questions: array\nrole: explore\nfunctions: []\n---\n\nPLAN_T: decompose.',
      'utf8',
    );
    await writeFile(
      join(tl, '02-investigate.md'),
      [
        '---',
        'id: investigate',
        'output:',
        '  question: string',
        'dependsOn: [plan]',
        'forEach: plan.questions',
        'role: explore',
        'functions: []',
        'prelude: |',
        '  const question = String(item);',
        '---',
        '',
        'INVESTIGATE_T: report the question.',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(tl, '03-collect.md'),
      '---\nid: collect\noutput:\n  questions: array\ngoal: true\ndependsOn: [investigate]\nrole: explore\nfunctions: []\n---\n\nCOLLECT_T: roll up.',
      'utf8',
    );

    const space = await loadSpace(dir);
    const streamFn = createMockStreamFn((o: StreamOpts) => {
      const user = o.messages.map((m) => m.content).join('\n');
      if (user.includes('PLAN_T')) return 'currentTask.resolve({ questions: ["q1", "q2"] });';
      // `question` was bound by the HOST prelude (per element) — the model only resolves.
      if (user.includes('INVESTIGATE_T')) return 'currentTask.resolve({ question });';
      if (user.includes('COLLECT_T')) {
        return 'currentTask.resolve({ questions: investigate.map((x: any) => x.question) });';
      }
      return '';
    });

    const engine = new ForkEngine({
      maxConcurrentForks: 4,
      parentHistory: [],
      parentSpaceDir: dir,
      parentAgentSlug: 'researcher',
      renderHost: silentHost,
      streamFn,
    });

    const env = await runTasklist({ name: 'per_item', space, forkEngine: engine, seed: { query: 't' } });
    expect(env.ok).toBe(true);
    expect(env.degraded).toBe(false);
    const goal = env.data as { questions: string[] };
    // Each element fork's prelude saw ITS OWN `item`.
    expect(goal.questions.sort()).toEqual(['q1', 'q2']);
  });
});

describe('tasklist-load: prelude frontmatter', () => {
  it('parses a `prelude` YAML block scalar into TaskNode.prelude', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'prelude-load-'));
    tmpDirs.push(dir);
    const file = join(dir, '01-gather.md');
    await writeFile(
      file,
      [
        '---',
        'id: gather',
        'output:',
        '  summary: string',
        'prelude: |',
        '  const question = String(item);',
        '  const results = await webSearch(question);',
        '---',
        '',
        'Summarize the pre-gathered results.',
      ].join('\n'),
      'utf8',
    );
    const tasks = await loadTasklist(dir, [file]);
    expect(tasks['gather']!.prelude).toBe(
      'const question = String(item);\nconst results = await webSearch(question);\n',
    );
  });

  it('rejects a non-string prelude at load time', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'prelude-load-bad-'));
    tmpDirs.push(dir);
    const file = join(dir, '01-bad.md');
    await writeFile(
      file,
      ['---', 'id: bad', 'output:', '  x: string', 'prelude:', '  - not', '  - a-string', '---', '', 'Body.'].join('\n'),
      'utf8',
    );
    await expect(loadTasklist(dir, [file])).rejects.toThrow(/"prelude" must be a non-empty string/);
  });

  it('rejects an empty-string prelude at load time', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'prelude-load-empty-'));
    tmpDirs.push(dir);
    const file = join(dir, '01-empty.md');
    await writeFile(
      file,
      ['---', 'id: empty', 'output:', '  x: string', 'prelude: "  "', '---', '', 'Body.'].join('\n'),
      'utf8',
    );
    await expect(loadTasklist(dir, [file])).rejects.toThrow(/"prelude" must be a non-empty string/);
  });
});
