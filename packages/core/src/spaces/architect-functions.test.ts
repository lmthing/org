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
const ARCHITECT_FUNCTIONS = join(__dirname, '..', '..', 'system-spaces', 'architect', 'functions');

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

  // Regression: a wrong-shape spec must fail fast with an actionable error and
  // write NOTHING — not crash with a cryptic "cannot read property 'replace' of
  // undefined" from deep inside joinPath (the bug that killed a live architect run).
  describe('spec-shape validation', () => {
    const run = (spec: unknown) => {
      const spaceDir = join(baseDir, 'bad-space');
      return evalDump(vm, `scaffoldSpace(${JSON.stringify(spaceDir)}, ${JSON.stringify(spec)})`) as any;
    };

    it('still rejects a nested spec that is invalid AFTER normalization (agent has no prompt)', () => {
      // The nested shape is normalized (see the dedicated normalize test), but an
      // agent with neither `instruct` nor `systemPrompt` has nothing to lift into
      // systemPrompt — validation must catch that with a named error, write nothing.
      const r = run({
        agents: { foo: { actions: { a: { tasklist: 'a', description: 'x' } } } },
      });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/systemPrompt/);
      expect(existsSync(join(baseDir, 'bad-space'))).toBe(false);
    });

    it('rejects a missing agentSlug with a named error', () => {
      const r = run({ agentTitle: 'X', systemPrompt: 'do things' });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/agentSlug/);
      expect(existsSync(join(baseDir, 'bad-space'))).toBe(false);
    });

    it('rejects `instruct` used in place of `systemPrompt`', () => {
      const r = run({ agentSlug: 'x', agentTitle: 'X', instruct: 'do things' });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/systemPrompt/);
    });

    it('rejects knowledge passed as an object instead of an array', () => {
      const r = run({
        agentSlug: 'x', agentTitle: 'X', systemPrompt: 'p',
        knowledge: { dom: { field: {} } },
      });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/knowledge must be an ARRAY/);
    });

    it('rejects a knowledge entry whose options is not an array', () => {
      const r = run({
        agentSlug: 'x', agentTitle: 'X', systemPrompt: 'p',
        knowledge: [{ domain: 'd', field: 'f', variable: 'v', description: 'desc', options: { a: 'b' } }],
      });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/options must be an ARRAY/);
    });

    // The model reliably emits this nested shape instead of the flat one.
    // scaffoldSpace must normalize it and produce a real, valid space — the
    // exact scenario that failed two live architect runs.
    it('normalizes the nested {agents/knowledge/functions/components/tasklists} shape into a valid space', () => {
      const spaceDir = join(baseDir, 'humanoid');
      const nested = {
        agents: {
          humanoid_robotics_analyst: {
            instruct: 'You are the Humanoid Robotics Analyst. Call loadKnowledge() then answer.',
            actions: {
              analyze_platform_fit: { tasklist: 'analyze_platform_fit', description: 'Recommend a platform for a use case' },
            },
          },
        },
        knowledge: {
          humanoid_robotics: {
            platforms: {
              index: 'Leading humanoid platforms as of 2026.',
              options: {
                leading_platforms: { title: 'Leading Platforms', content: '## Figure 03\nSource: https://x' },
                platform_comparison: 'A bare-string option body is also accepted.',
              },
            },
            market: {
              index: 'Commercial deployments and market dynamics.',
              options: { market_overview: { content: '## Market\n$0.9B in 2025. Source: https://y' } },
            },
          },
        },
        functions: {
          comparePlatforms: { code: 'export function comparePlatforms(a: string[]) { return a.length; }' },
        },
        components: {
          PlatformCard: { type: 'view', code: 'export default function PlatformCard() { return null; }' },
          PlatformQueryForm: { type: 'form', code: 'export default function PlatformQueryForm() { return null; }' },
        },
        tasklists: {
          analyze_platform_fit: {
            tasks: [
              { id: '1-load', content: 'Load knowledge from humanoid_robotics/platforms.', output: { loaded: 'boolean' } },
              { id: '2-recommend', content: 'Recommend a platform and resolve.', output: { recommendation: 'string' } },
            ],
          },
        },
      };

      const r = evalDump(vm, `scaffoldSpace(${JSON.stringify(spaceDir)}, ${JSON.stringify(nested)})`) as any;
      expect(r.ok).toBe(true);
      // (run-3 shape variations covered by the dedicated test below)
      // agent (instruct → systemPrompt, slug → title) was written
      expect(existsSync(join(spaceDir, 'agents', 'humanoid_robotics_analyst', 'instruct.md'))).toBe(true);
      const instruct = readFileSync(join(spaceDir, 'agents', 'humanoid_robotics_analyst', 'instruct.md'), 'utf8');
      expect(instruct).toMatch(/title: Humanoid Robotics Analyst/);
      expect(instruct).toMatch(/loadKnowledge/);
      // knowledge tree (object-map options, incl. a bare-string option) written
      expect(existsSync(join(spaceDir, 'knowledge', 'humanoid_robotics', 'platforms', 'index.md'))).toBe(true);
      expect(existsSync(join(spaceDir, 'knowledge', 'humanoid_robotics', 'platforms', 'leading_platforms.md'))).toBe(true);
      expect(existsSync(join(spaceDir, 'knowledge', 'humanoid_robotics', 'platforms', 'platform_comparison.md'))).toBe(true);
      expect(existsSync(join(spaceDir, 'knowledge', 'humanoid_robotics', 'market', 'market_overview.md'))).toBe(true);
      // function (code → source), components split by type, tasklist (content → instruction)
      expect(existsSync(join(spaceDir, 'functions', 'comparePlatforms.ts'))).toBe(true);
      expect(existsSync(join(spaceDir, 'components', 'view', 'PlatformCard.tsx'))).toBe(true);
      expect(existsSync(join(spaceDir, 'components', 'form', 'PlatformQueryForm', 'web.tsx'))).toBe(true);
      expect(existsSync(join(spaceDir, 'components', 'form', 'PlatformQueryForm', 'ink.tsx'))).toBe(true);
      expect(existsSync(join(spaceDir, 'tasklists', 'analyze_platform_fit', '01-load.md'))).toBe(true);
      // last task became the goal
      const goalTask = readFileSync(join(spaceDir, 'tasklists', 'analyze_platform_fit', '02-recommend.md'), 'utf8');
      expect(goalTask).toMatch(/goal: true/);

      const v = evalDump(vm, `validateSpace(${JSON.stringify(spaceDir)})`) as any;
      expect(v.ok).toBe(true);
      expect(v.errors).toHaveLength(0);
    });

    // Run-3 shape: bare-string values, extensions baked into keys, knowledge under
    // `files` (not `options`), and tasklist tasks as a map of "N-id.md" → markdown.
    it('normalizes bare-string values, extension-keys, `files`, and map-of-task-files', () => {
      const spaceDir = join(baseDir, 'humanoid3');
      const nested = {
        agents: {
          humanoid_robotics_analyst: {
            instruct: 'Analyst. loadKnowledge then answer.',
            actions: { analyze_platform: { tasklist: 'analyze_platform', description: 'Analyze platforms' } },
          },
        },
        knowledge: {
          humanoid_robotics: {
            platforms: {
              index: 'Overview of platforms.',
              files: {
                'leading_platforms.md': '# Leading Platforms\nFigure 03. Source: https://x',
                'comparison.md': '# Comparison\nTable. Source: https://y',
              },
            },
          },
        },
        functions: {
          'compare_platforms.ts': 'export function compare_platforms(a: string[]) { return a.length; }',
        },
        components: {
          'PlatformComparisonView.tsx': 'export default function PlatformComparisonView() { return null; }',
          'MarketAnalysisForm.tsx': 'export default function MarketAnalysisForm() { return null; }',
        },
        tasklists: {
          analyze_platform: {
            '1-analyze.md': '# Analyze\nLoad knowledge, compare, and resolve the recommendation.',
          },
        },
      };

      const r = evalDump(vm, `scaffoldSpace(${JSON.stringify(spaceDir)}, ${JSON.stringify(nested)})`) as any;
      expect(r.ok).toBe(true);
      // No double extensions
      expect(existsSync(join(spaceDir, 'functions', 'compare_platforms.ts'))).toBe(true);
      expect(existsSync(join(spaceDir, 'functions', 'compare_platforms.ts.ts'))).toBe(false);
      expect(existsSync(join(spaceDir, 'components', 'view', 'PlatformComparisonView.tsx'))).toBe(true);
      expect(existsSync(join(spaceDir, 'components', 'view', 'PlatformComparisonView.tsx.tsx'))).toBe(false);
      // Form inferred from the name → form/, with web + ink
      expect(existsSync(join(spaceDir, 'components', 'form', 'MarketAnalysisForm', 'web.tsx'))).toBe(true);
      expect(existsSync(join(spaceDir, 'components', 'form', 'MarketAnalysisForm', 'ink.tsx'))).toBe(true);
      // `files` options written, .md stripped from slug, content non-empty
      const opt = join(spaceDir, 'knowledge', 'humanoid_robotics', 'platforms', 'leading_platforms.md');
      expect(existsSync(opt)).toBe(true);
      expect(readFileSync(opt, 'utf8')).toMatch(/Figure 03/);
      // map-of-task-files → a goal task file
      expect(existsSync(join(spaceDir, 'tasklists', 'analyze_platform', '01-analyze.md'))).toBe(true);
      expect(readFileSync(join(spaceDir, 'tasklists', 'analyze_platform', '01-analyze.md'), 'utf8')).toMatch(/goal: true/);

      const v = evalDump(vm, `validateSpace(${JSON.stringify(spaceDir)})`) as any;
      expect(v.ok).toBe(true);
    });

    it('accepts a correct flat spec (sanity)', () => {
      const r = run({
        agentSlug: 'good', agentTitle: 'Good', systemPrompt: 'p',
        actions: [{ id: 'a', label: 'A', description: 'd', tasklist: 'a' }],
        tasklists: [{ name: 'a', tasks: [{ id: 'a', instruction: 'i', output: { r: 'string' }, goal: true }] }],
      });
      expect(r.ok).toBe(true);
    });

    it('strips a spurious top-level agents key when agentSlug is already present', () => {
      // Model sometimes emits both agentSlug at top level AND a nested agents object.
      // normalizeSpec should strip the agents key and pass the flat spec through.
      const r = run({
        agentSlug: 'good', agentTitle: 'Good', systemPrompt: 'p',
        agents: { good: { instruct: 'should be ignored' } },
        actions: [{ id: 'a', label: 'A', description: 'd', tasklist: 'a' }],
        tasklists: [{ name: 'a', tasks: [{ id: 'a', instruction: 'i', output: { r: 'string' }, goal: true }] }],
      });
      expect(r.ok).toBe(true);
    });
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

  // Regression: model emits knowledge as a flat { 'index.md': ..., 'file.md': ... } map
  // directly on the field object (no nested 'options' property). normalizeSpec must detect
  // the .md-keyed entries and use them as option files, and 'index.md' as the description.
  it('normalizes flat md-keyed knowledge file maps (run-ficus regression)', () => {
    const spaceDir = join(baseDir, 'ficus-knowledge');
    const nested = {
      agents: {
        ficus_expert: {
          instruct: 'Ficus elastica specialist. Call loadKnowledge then answer.',
          actions: { get_care_plan: { tasklist: 'care_plan', description: 'Get a care plan' } },
        },
      },
      knowledge: {
        botany: {
          taxonomy: {
            'index.md': '# Taxonomy\nFicus elastica is in family Moraceae.\n\n## Sources\n- https://en.wikipedia.org/wiki/Ficus_elastica',
            'native_regions.md': '# Native Regions\nNative to South and Southeast Asia.\n\n## Sources\n- https://borneoficus.info',
            'morphology.md': '# Morphology\nLeaves 9–30 cm long, dark green.\n\n## Sources\n- https://plants.ces.ncsu.edu',
          },
        },
      },
      tasklists: {
        care_plan: {
          tasks: [
            { id: '01-assess', content: 'Assess plant condition.' },
            { id: '02-plan', content: 'Create care plan and resolve.', goal: true },
          ],
        },
      },
    };

    const r = evalDump(vm, `scaffoldSpace(${JSON.stringify(spaceDir)}, ${JSON.stringify(nested)})`) as any;
    expect(r.ok).toBe(true);

    // index.md content (the taxonomy description) must be written, not the placeholder
    const idxPath = join(spaceDir, 'knowledge', 'botany', 'taxonomy', 'index.md');
    expect(existsSync(idxPath)).toBe(true);
    const idxContent = readFileSync(idxPath, 'utf8');
    expect(idxContent).toMatch(/Moraceae/);
    expect(idxContent).not.toBe('botany taxonomy');

    // option files must be written with their content
    const nativePath = join(spaceDir, 'knowledge', 'botany', 'taxonomy', 'native_regions.md');
    expect(existsSync(nativePath)).toBe(true);
    expect(readFileSync(nativePath, 'utf8')).toMatch(/Southeast Asia/);

    const morphPath = join(spaceDir, 'knowledge', 'botany', 'taxonomy', 'morphology.md');
    expect(existsSync(morphPath)).toBe(true);
    expect(readFileSync(morphPath, 'utf8')).toMatch(/dark green/);

    const v = evalDump(vm, `validateSpace(${JSON.stringify(spaceDir)})`) as any;
    expect(v.ok).toBe(true);
  });

  // Regression: form components passed as bare source strings (no type:'form') where the
  // name doesn't end in 'form' were classified as view components. normalizeSpec must also
  // detect <Form in the source body to correctly route to components/form/.
  it('detects form components by <Form> in source when name does not end in Form', () => {
    const spaceDir = join(baseDir, 'form-detect');
    const nested = {
      agents: {
        test_agent: {
          instruct: 'Test agent.',
          actions: { run: { tasklist: 'run', description: 'Run' } },
        },
      },
      components: {
        // Name does NOT end in 'form/Form' — detection must rely on source content
        'LeafSymptomChecker.tsx': `import { Form, Field, Select, TextField } from './catalog';
export default function LeafSymptomChecker() {
  return (
    <Form>
      <Field name="symptom"><Select name="symptom" options={[]} /></Field>
      <Field name="desc"><TextField name="desc" /></Field>
    </Form>
  );
}`,
        // Ends in 'Form' — detected by name
        'PropagationPlannerForm.tsx': 'export default function PropagationPlannerForm() { return <Form><Field name="x"><Select name="x" options={[]} /></Field></Form>; }',
        // View component — no <Form, name doesn't end in Form
        'PlantHealthDashboard.tsx': 'export default function PlantHealthDashboard({ score }: any) { return <div>{score}</div>; }',
      },
      tasklists: {
        run: { tasks: [{ id: 'run', content: 'Run and resolve.', goal: true }] },
      },
    };

    const r = evalDump(vm, `scaffoldSpace(${JSON.stringify(spaceDir)}, ${JSON.stringify(nested)})`) as any;
    expect(r.ok).toBe(true);

    // LeafSymptomChecker detected as form via <Form in source
    expect(existsSync(join(spaceDir, 'components', 'form', 'LeafSymptomChecker', 'web.tsx'))).toBe(true);
    expect(existsSync(join(spaceDir, 'components', 'form', 'LeafSymptomChecker', 'ink.tsx'))).toBe(true);
    expect(existsSync(join(spaceDir, 'components', 'view', 'LeafSymptomChecker.tsx'))).toBe(false);

    // PropagationPlannerForm detected as form via name suffix
    expect(existsSync(join(spaceDir, 'components', 'form', 'PropagationPlannerForm', 'web.tsx'))).toBe(true);

    // PlantHealthDashboard stays as view
    expect(existsSync(join(spaceDir, 'components', 'view', 'PlantHealthDashboard.tsx'))).toBe(true);
    expect(existsSync(join(spaceDir, 'components', 'form', 'PlantHealthDashboard'))).toBe(false);
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
