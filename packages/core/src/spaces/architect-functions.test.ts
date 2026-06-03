import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVM, type VM } from '../sandbox/quickjs.js';
import { injectHostTools } from '../globals/host-tools.js';
import { transpileStatement } from '../typecheck/transpile.js';
import type { RenderHost } from '../session/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARCHITECT_FUNCTIONS = join(__dirname, '..', '..', '..', '..', 'fixtures', 'architect', 'functions');

const host: RenderHost = {
  display: () => {},
  ask: async () => undefined,
  log: () => {},
};

function injectFn(vm: VM, name: string): void {
  const src = readFileSync(join(ARCHITECT_FUNCTIONS, `${name}.ts`), 'utf8');
  const js = transpileStatement(src)
    .replace(/^export\s+default\s+function\s+/gm, `function ${name} `)
    .replace(/^export\s+default\s+/gm, `const ${name} = `)
    .replace(/^export\s+/gm, '');
  const r = vm.evalScript(`${js}\nglobalThis['${name}'] = ${name};`);
  if (!r.ok) throw new Error(`inject ${name} failed: ${r.error}`);
}

function evalDump(vm: VM, code: string): unknown {
  const res = vm.ctx.evalCode(code);
  if (res.error) {
    const err = vm.ctx.dump(res.error);
    res.error.dispose();
    throw new Error(`eval error: ${JSON.stringify(err)}`);
  }
  const value = vm.ctx.dump(res.value);
  res.value.dispose();
  return value;
}

describe('architect scaffoldSpace + validateSpace', () => {
  let vm: VM;
  let baseDir: string;

  beforeEach(async () => {
    baseDir = mkdtempSync(join(tmpdir(), 'architect-test-'));
    vm = await createVM();
    injectHostTools(vm, { renderHost: host, spaceDir: baseDir });
    injectFn(vm, 'scaffoldSpace');
    injectFn(vm, 'validateSpace');
  });

  afterEach(() => {
    vm.dispose();
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('scaffolds a minimal space and validates successfully', () => {
    const spaceDir = join(baseDir, 'word-counter');
    const spec = JSON.stringify({
      agentSlug: 'word-counter',
      agentTitle: 'Word Counter',
      systemPrompt: 'Count words in the provided text.',
      actions: [{ id: 'count', label: 'Count Words', description: 'Count words', tasklist: 'count' }],
      tasklists: [{
        name: 'count',
        tasks: [
          {
            id: 'count',
            instruction: 'Count the words in the input text and return the total.',
            output: { total: 'number' },
            goal: true,
          },
        ],
      }],
    });

    const scaffoldResult = evalDump(vm, `scaffoldSpace(${JSON.stringify(spaceDir)}, ${spec})`);
    expect((scaffoldResult as any).ok).toBe(true);
    expect(existsSync(join(spaceDir, 'agents', 'word-counter', 'instruct.md'))).toBe(true);
    expect(existsSync(join(spaceDir, 'tasklists', 'count', '01-count.md'))).toBe(true);

    const validateResult = evalDump(vm, `validateSpace(${JSON.stringify(spaceDir)})`);
    expect((validateResult as any).ok).toBe(true);
    expect((validateResult as any).errors).toHaveLength(0);
  });

  it('scaffolds knowledge tree and validates the fields', () => {
    const spaceDir = join(baseDir, 'chess-explainer');
    const spec = JSON.stringify({
      agentSlug: 'chess-explainer',
      agentTitle: 'Chess Explainer',
      systemPrompt: 'Explain chess rules using loaded knowledge.',
      actions: [{ id: 'explain', label: 'Explain', description: 'Explain rules', tasklist: 'explain' }],
      tasklists: [{
        name: 'explain',
        tasks: [{ id: 'explain', instruction: 'Explain the rules.', output: { answer: 'string' }, goal: true }],
      }],
      knowledge: [{
        domain: 'chess_rules',
        field: 'pieces',
        type: 'string',
        variable: 'piecesKnowledge',
        default: 'overview',
        description: 'Movement rules for each chess piece.',
        options: [
          { slug: 'overview', content: '# Piece Overview\n\nKing moves one square.' },
          { slug: 'special_moves', content: '# Special Moves\n\nCastling and en passant.' },
        ],
      }],
    });

    const scaffoldResult = evalDump(vm, `scaffoldSpace(${JSON.stringify(spaceDir)}, ${spec})`);
    expect((scaffoldResult as any).ok).toBe(true);

    // Knowledge files should exist
    expect(existsSync(join(spaceDir, 'knowledge', 'chess_rules', 'pieces', 'index.md'))).toBe(true);
    expect(existsSync(join(spaceDir, 'knowledge', 'chess_rules', 'pieces', 'overview.md'))).toBe(true);
    expect(existsSync(join(spaceDir, 'knowledge', 'chess_rules', 'pieces', 'special_moves.md'))).toBe(true);

    // instruct.md should reference the knowledge domain
    const instruct = readFileSync(join(spaceDir, 'agents', 'chess-explainer', 'instruct.md'), 'utf8');
    expect(instruct).toContain('knowledge:\n  - chess_rules/pieces');

    const validateResult = evalDump(vm, `validateSpace(${JSON.stringify(spaceDir)})`);
    expect((validateResult as any).ok).toBe(true);
    expect((validateResult as any).errors).toHaveLength(0);
  });

  it('scaffolds view and form components', () => {
    const spaceDir = join(baseDir, 'dashboard');
    const spec = JSON.stringify({
      agentSlug: 'dashboard',
      agentTitle: 'Dashboard',
      systemPrompt: 'Display a dashboard.',
      actions: [{ id: 'show', label: 'Show', description: 'Show dashboard', tasklist: 'show' }],
      tasklists: [{
        name: 'show',
        tasks: [{ id: 'show', instruction: 'Show the dashboard.', output: { done: 'boolean' }, goal: true }],
      }],
      components: {
        view: [{ name: 'ScoreCard', source: 'export default function ScoreCard({ score }: { score: number }) { return <div>{score}</div>; }' }],
        form: [{ name: 'QueryForm', web: 'export default function QueryForm({ onSubmit }: any) { return <form onSubmit={onSubmit}><button>Go</button></form>; }', ink: 'export default function QueryForm({ onSubmit }: any) { return <Box><Text>Go</Text></Box>; }' }],
      },
    });

    const scaffoldResult = evalDump(vm, `scaffoldSpace(${JSON.stringify(spaceDir)}, ${spec})`);
    expect((scaffoldResult as any).ok).toBe(true);

    expect(existsSync(join(spaceDir, 'components', 'view', 'ScoreCard.tsx'))).toBe(true);
    expect(existsSync(join(spaceDir, 'components', 'form', 'QueryForm', 'web.tsx'))).toBe(true);
    expect(existsSync(join(spaceDir, 'components', 'form', 'QueryForm', 'ink.tsx'))).toBe(true);

    const instruct = readFileSync(join(spaceDir, 'agents', 'dashboard', 'instruct.md'), 'utf8');
    expect(instruct).toContain('components:\n  - ScoreCard\n  - QueryForm');

    const validateResult = evalDump(vm, `validateSpace(${JSON.stringify(spaceDir)})`);
    expect((validateResult as any).ok).toBe(true);
  });

  it('validateSpace reports missing knowledge index.md', () => {
    const spaceDir = join(baseDir, 'bad-knowledge');
    // Scaffold without knowledge, then add a knowledge ref manually to instruct.md
    const spec = JSON.stringify({
      agentSlug: 'bad-knowledge',
      agentTitle: 'Bad Knowledge',
      systemPrompt: 'Test.',
      actions: [{ id: 'run', label: 'Run', description: 'Run', tasklist: 'run' }],
      tasklists: [{ name: 'run', tasks: [{ id: 'run', instruction: 'Run.', output: { ok: 'boolean' }, goal: true }] }],
    });
    evalDump(vm, `scaffoldSpace(${JSON.stringify(spaceDir)}, ${spec})`);

    // Overwrite instruct.md with a knowledge ref pointing to a non-existent domain
    const broken = `---\ntitle: Bad Knowledge\nknowledge:\n  - missing_domain/missing_field\nfunctions: []\ncomponents: []\nactions:\n  - id: run\n    label: "Run"\n    description: "Run"\n    tasklist: run\ndependencies: []\n---\n\nTest.`;
    evalDump(vm, `writeFileRaw(${JSON.stringify(join(spaceDir, 'agents', 'bad-knowledge', 'instruct.md'))}, ${JSON.stringify(broken)})`);

    const validateResult = evalDump(vm, `validateSpace(${JSON.stringify(spaceDir)})`);
    expect((validateResult as any).ok).toBe(false);
    expect((validateResult as any).errors.some((e: string) => e.includes('index.md not found'))).toBe(true);
  });

  it('validateSpace reports dependsOn integrity violation', () => {
    const spaceDir = join(baseDir, 'bad-deps');
    const spec = JSON.stringify({
      agentSlug: 'bad-deps',
      agentTitle: 'Bad Deps',
      systemPrompt: 'Test.',
      actions: [{ id: 'run', label: 'Run', description: 'Run', tasklist: 'run' }],
      tasklists: [{
        name: 'run',
        tasks: [
          { id: 'step1', instruction: 'First step.', output: { out: 'string' }, goal: false },
          { id: 'step2', instruction: 'Second step.', output: { result: 'string' }, dependsOn: ['nonexistent'], goal: true },
        ],
      }],
    });

    evalDump(vm, `scaffoldSpace(${JSON.stringify(spaceDir)}, ${spec})`);
    const validateResult = evalDump(vm, `validateSpace(${JSON.stringify(spaceDir)})`);
    expect((validateResult as any).ok).toBe(false);
    expect((validateResult as any).errors.some((e: string) => e.includes('nonexistent'))).toBe(true);
  });

  it('validateSpace reports forbidden import in function', () => {
    const spaceDir = join(baseDir, 'bad-fn');
    const spec = JSON.stringify({
      agentSlug: 'bad-fn',
      agentTitle: 'Bad Fn',
      systemPrompt: 'Test.',
      functions: [{ name: 'badFn', source: 'import fs from "node:fs";\nexport function badFn() { return fs.readFileSync("/tmp/x"); }' }],
      actions: [{ id: 'run', label: 'Run', description: 'Run', tasklist: 'run' }],
      tasklists: [{ name: 'run', tasks: [{ id: 'run', instruction: 'Run.', output: { ok: 'boolean' }, goal: true }] }],
    });

    evalDump(vm, `scaffoldSpace(${JSON.stringify(spaceDir)}, ${spec})`);
    const validateResult = evalDump(vm, `validateSpace(${JSON.stringify(spaceDir)})`);
    expect((validateResult as any).ok).toBe(false);
    expect((validateResult as any).errors.some((e: string) => e.includes('import'))).toBe(true);
  });

  it('rescaffold is idempotent — running twice overwrites cleanly', () => {
    const spaceDir = join(baseDir, 'idempotent');
    const spec1 = JSON.stringify({
      agentSlug: 'idempotent',
      agentTitle: 'V1',
      systemPrompt: 'Version 1.',
      actions: [{ id: 'run', label: 'Run', description: 'Run', tasklist: 'run' }],
      tasklists: [{ name: 'run', tasks: [{ id: 'run', instruction: 'Run v1.', output: { ok: 'boolean' }, goal: true }] }],
    });
    const spec2 = JSON.stringify({
      agentSlug: 'idempotent',
      agentTitle: 'V2',
      systemPrompt: 'Version 2 — improved.',
      actions: [{ id: 'run', label: 'Run', description: 'Run', tasklist: 'run' }],
      tasklists: [{ name: 'run', tasks: [{ id: 'run', instruction: 'Run v2.', output: { ok: 'boolean' }, goal: true }] }],
    });

    evalDump(vm, `scaffoldSpace(${JSON.stringify(spaceDir)}, ${spec1})`);
    evalDump(vm, `scaffoldSpace(${JSON.stringify(spaceDir)}, ${spec2})`);

    const instruct = readFileSync(join(spaceDir, 'agents', 'idempotent', 'instruct.md'), 'utf8');
    expect(instruct).toContain('Version 2 — improved.');
    expect(instruct).not.toContain('Version 1.');

    const taskFile = readFileSync(join(spaceDir, 'tasklists', 'run', '01-run.md'), 'utf8');
    expect(taskFile).toContain('Run v2.');

    const validateResult = evalDump(vm, `validateSpace(${JSON.stringify(spaceDir)})`);
    expect((validateResult as any).ok).toBe(true);
  });
});
