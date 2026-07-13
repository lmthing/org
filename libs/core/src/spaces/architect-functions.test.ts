import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVM, type VM } from '../sandbox/quickjs.js';
import { injectHostTools } from '../globals/host-tools.js';
import { transpileStatement } from '../typecheck/transpile.js';
import { loadSpace } from './load.js';
import { loadTasklistFromSpace } from './tasklist-load.js';
import { validateDag, resolveGoalTask } from '../tasklist/dag.js';
import type { RenderHost } from '../session/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARCHITECT_DIR = join(__dirname, '..', '..', 'system-spaces', 'system-architect');
const FNS = join(ARCHITECT_DIR, 'functions');
const host: RenderHost = { display: () => {}, ask: async () => undefined, log: () => {} };

function injectFn(vm: VM, name: string): void {
  const src = readFileSync(join(FNS, `${name}.ts`), 'utf8');
  const js = transpileStatement(src)
    .replace(/^export\s+default\s+function\s+/gm, `function ${name} `)
    .replace(/^export\s+default\s+/gm, `const ${name} = `)
    .replace(/^export\s+/gm, '');
  const r = vm.evalScript(`${js}\nglobalThis['${name}'] = ${name};`);
  if (!r.ok) throw new Error(`inject ${name} failed: ${r.error}`);
}
function evalDump(vm: VM, code: string): any {
  const res = vm.ctx.evalCode(code);
  if (res.error) { const e = vm.ctx.dump(res.error); res.error.dispose(); throw new Error(JSON.stringify(e)); }
  const v = vm.ctx.dump(res.value); res.value.dispose(); return v;
}

describe('per-file builders smoke', () => {
  let vm: VM; let baseDir: string;
  beforeEach(async () => {
    baseDir = mkdtempSync(join(tmpdir(), 'builders-'));
    vm = await createVM();
    injectHostTools(vm, { renderHost: host, spaceDir: baseDir });
    for (const f of ['writeAgentFile', 'writeFunctionFile', 'writeTaskFile', 'writeKnowledgeIndex', 'writeKnowledgeOption', 'writeComponentFile', 'validateSpace']) injectFn(vm, f);
  });
  afterEach(() => { vm.dispose(); rmSync(baseDir, { recursive: true, force: true }); });

  it('builds a valid, registerable space file-by-file', () => {
    const dir = join(baseDir, 'dog-expert');
    const D = JSON.stringify(dir);
    const agent = evalDump(vm, `writeAgentFile(${D}, ${JSON.stringify({
      agentSlug: 'dog-expert', agentTitle: 'Dog Expert',
      systemPrompt: 'You are a dog breed expert. Answer using pre-researched knowledge where available.',
      knowledge: ['dogs/breeds'], functions: ['scoreBreed'],
      actions: [{ id: 'answer', label: 'Answer', description: 'Answer a dog question', tasklist: 'answer' }],
    })})`);
    expect(agent.ok).toBe(true);

    // New knowledge contract: index.md body is the OVERVIEW (covers all options); the
    // field has >=2 aspect option files (never a single "overview" option).
    const ki = evalDump(vm, `writeKnowledgeIndex(${D}, "dogs", "breeds", ${JSON.stringify({ variable: 'breeds', default: 'retrievers', description: 'Dog breeds grouped by purpose: retrievers (work/family), toy breeds (companions), and herding dogs each have distinct temperaments and care needs.' })})`);
    expect(ki.ok).toBe(true);
    const ko1 = evalDump(vm, `writeKnowledgeOption(${D}, "dogs", "breeds", "retrievers", ${JSON.stringify('# Retrievers\\nLabrador and Golden Retrievers: friendly, energetic family dogs.')})`);
    expect(ko1.ok).toBe(true);
    const ko2 = evalDump(vm, `writeKnowledgeOption(${D}, "dogs", "breeds", "toy_breeds", ${JSON.stringify('# Toy Breeds\\nPoodle and Chihuahua: small companion dogs for apartments.')})`);
    expect(ko2.ok).toBe(true);

    const fn = evalDump(vm, `writeFunctionFile(${D}, "scoreBreed", ${JSON.stringify('export function scoreBreed(name: string): number { return name.length; }')})`);
    expect(fn.ok).toBe(true);

    const t1 = evalDump(vm, `writeTaskFile(${D}, "answer", ${JSON.stringify({ id: 'reply', instruction: 'Load knowledge then answer. Resolve: currentTask.resolve({ answer })', output: { answer: 'string' }, goal: true })})`);
    expect(t1.ok).toBe(true);
    expect(t1.path).toMatch(/01-reply\.md$/);

    const v = evalDump(vm, `validateSpace(${D})`);
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
    expect(existsSync(join(dir, 'agents', 'dog-expert', 'instruct.md'))).toBe(true);
  });

  it('rejects placeholder loadKnowledge in agent prompt and task instruction', () => {
    const dir = join(baseDir, 'sP'); const D = JSON.stringify(dir);
    const a = evalDump(vm, `writeAgentFile(${D}, ${JSON.stringify({
      agentSlug: 'p', agentTitle: 'P',
      systemPrompt: "Load it: await loadKnowledge('<domain>', '<field>', '<aspect>.md')",
      actions: [{ id: 'go', label: 'Go', description: 'd', tasklist: 'go' }],
    })})`);
    expect(a.ok).toBe(false);
    expect(a.error).toMatch(/placeholder/i);
    const t = evalDump(vm, `writeTaskFile(${D}, "go", ${JSON.stringify({ id: 'x', instruction: "await loadKnowledge('<domain>', '<field>', '<aspect>.md')", output: { r: 'string' }, goal: true })})`);
    expect(t.ok).toBe(false);
    expect(t.error).toMatch(/placeholder/i);
  });

  // A knowledge-grounded task that is told only to "answer, grounded in the knowledge" has no rule
  // for the case that matters: the knowledge is SILENT on the question. Live, a generated insurance
  // agent then answered a market-check question from its (unrelated) car-policy note and told the
  // user there was a cheaper option — naming their own current insurer. Every task that loads
  // knowledge must carry the grounding rule, whatever prose the architect's model wrote.
  it('appends the grounding rule to every task that loads knowledge (never answer past the knowledge)', () => {
    const dir = join(baseDir, 'sG'); const D = JSON.stringify(dir);
    evalDump(vm, `writeAgentFile(${D}, ${JSON.stringify({ agentSlug: 'g', agentTitle: 'G', systemPrompt: 'x', actions: [{ id: 'answer', label: 'A', description: 'd', tasklist: 'answer' }] })})`);

    const grounded = evalDump(vm, `writeTaskFile(${D}, "answer", ${JSON.stringify({
      id: 'reply',
      instruction: "Answer `query`. Code:\nconst k = await loadKnowledge('insurance','car','policy.md');\ncurrentTask.resolve({ answer: 'md' });",
      output: { answer: 'string' }, goal: true,
    })})`);
    expect(grounded.ok).toBe(true);
    const body = readFileSync(grounded.path, 'utf8');
    expect(body).toMatch(/does not answer/i);
    expect(body).toMatch(/never infer, guess, or present a conclusion the knowledge does not state/i);

    // Already stated in the model's own words → not duplicated.
    const already = evalDump(vm, `writeTaskFile(${D}, "answer", ${JSON.stringify({
      id: 'own',
      instruction: "await loadKnowledge('insurance','car','policy.md'); If the notes don't cover it, say so — never invent.",
      output: { answer: 'string' },
    })})`);
    expect(readFileSync(already.path, 'utf8')).not.toMatch(/never infer, guess, or present/i);

    // A task that loads NO knowledge is left exactly as authored.
    const plain = evalDump(vm, `writeTaskFile(${D}, "answer", ${JSON.stringify({
      id: 'plain', instruction: 'Compute the total. currentTask.resolve({ answer: "42" });', output: { answer: 'string' },
    })})`);
    expect(readFileSync(plain.path, 'utf8')).not.toMatch(/never infer/i);
  });

  it('rejects a function with a syntax error (typecheck on write)', () => {
    const dir = join(baseDir, 's2'); const D = JSON.stringify(dir);
    const fn = evalDump(vm, `writeFunctionFile(${D}, "broken", ${JSON.stringify('export function broken( { return 1 }')})`);
    expect(fn.ok).toBe(false);
    expect(fn.errors.length).toBeGreaterThan(0);
    expect(existsSync(join(dir, 'functions', 'broken.ts'))).toBe(false);
  });

  it('re-writes a task in place (idempotent ordinal)', () => {
    const dir = join(baseDir, 's3'); const D = JSON.stringify(dir);
    evalDump(vm, `writeAgentFile(${D}, ${JSON.stringify({ agentSlug: 'a', agentTitle: 'A', systemPrompt: 'x', actions: [{ id: 'go', label: 'Go', description: 'd', tasklist: 'go' }] })})`);
    evalDump(vm, `writeTaskFile(${D}, "go", ${JSON.stringify({ id: 'one', instruction: 'first', output: { r: 'string' } })})`);
    const t2 = evalDump(vm, `writeTaskFile(${D}, "go", ${JSON.stringify({ id: 'two', instruction: 'second', output: { r: 'string' }, goal: true })})`);
    expect(t2.path).toMatch(/02-two\.md$/);
    const t1b = evalDump(vm, `writeTaskFile(${D}, "go", ${JSON.stringify({ id: 'one', instruction: 'first-rev', output: { r: 'string' } })})`);
    expect(t1b.path).toMatch(/01-one\.md$/);
    expect(readFileSync(join(dir, 'tasklists', 'go', '01-one.md'), 'utf8')).toContain('first-rev');
  });

  it('writeAgentFile emits defaultAction and canDelegateTo (not the legacy dependencies)', () => {
    const dir = join(baseDir, 's4'); const D = JSON.stringify(dir);
    evalDump(vm, `writeAgentFile(${D}, ${JSON.stringify({ agentSlug: 'a', agentTitle: 'A', systemPrompt: 'x', defaultAction: 'go', canDelegateTo: ['other-space/helper#run'], actions: [{ id: 'go', label: 'Go', description: 'd', tasklist: 'go' }, { id: 'other', label: 'O', description: 'd', tasklist: 'other' }] })})`);
    const fm = readFileSync(join(dir, 'agents', 'a', 'instruct.md'), 'utf8');
    expect(fm).toContain('defaultAction: go');
    expect(fm).toContain('canDelegateTo:');
    expect(fm).toContain('- other-space/helper#run');
    expect(fm).not.toContain('dependencies:'); // org/format/space/agents/frontmatter.md: canDelegateTo replaces dependencies
  });
});

describe('system-architect space loads with the restructured tasklists', () => {
  it('loads the architect space and resolves the per-file builder functions', async () => {
    const space = await loadSpace(ARCHITECT_DIR);
    const architect = space.agents['architect']!;
    expect(architect).toBeTruthy();
    // The agent declares the per-file builders (not the removed scaffoldSpace/parseSkill).
    const declared = new Set(architect.config.functions);
    for (const fn of ['writeAgentFile', 'writeTaskFile', 'writeFunctionFile', 'writeKnowledgeIndex', 'writeKnowledgeOption', 'writeComponentFile', 'validateSpace']) {
      expect(declared.has(fn)).toBe(true);
    }
    // The removed import agent is gone.
    expect(space.agents['skill-to-space-transformer']).toBeUndefined();
  });

  it('synthesize_and_run is a valid DAG: design→(build_field/build_function fan-out)→write_agent→write_tasks→validate→register→finalize', async () => {
    const space = await loadSpace(ARCHITECT_DIR);
    const tasks = await loadTasklistFromSpace(space, 'synthesize_and_run');
    expect(() => validateDag(tasks)).not.toThrow();
    expect(Object.keys(tasks).sort()).toEqual(
      ['build_field', 'build_function', 'design', 'finalize', 'register', 'validate', 'write_agent', 'write_tasks'],
    );
    expect(resolveGoalTask(tasks)?.id).toBe('finalize');
    // Per-file builds fan out over the design step's arrays (host-driven map nodes).
    expect(tasks['build_field']!.forEach).toBe('design.fields');
    expect(tasks['build_function']!.forEach).toBe('design.functions');
    // Read-only steps are explore; file-writing steps are general (least privilege).
    expect(tasks['design']!.role).toBe('explore');
    expect(tasks['write_agent']!.role).toBe('general');
    expect(tasks['validate']!.role).toBe('explore');
    // write_agent waits for both fan-outs; register waits for validate.
    expect(tasks['write_agent']!.dependsOn).toEqual(['design', 'build_field', 'build_function']);
    expect(tasks['register']!.dependsOn).toEqual(['design', 'validate']);
  });

  it('iterate_space is a valid DAG: load→diagnose→edit→reregister→redelegate, redelegate is the goal', async () => {
    const space = await loadSpace(ARCHITECT_DIR);
    const tasks = await loadTasklistFromSpace(space, 'iterate_space');
    expect(() => validateDag(tasks)).not.toThrow();
    expect(Object.keys(tasks).sort()).toEqual(['diagnose', 'edit', 'load', 'redelegate', 'reregister']);
    expect(resolveGoalTask(tasks)?.id).toBe('redelegate');
    // A4: redelegate threads load's actionId, so it depends on load (not just reregister).
    expect(tasks['redelegate']!.dependsOn).toEqual(['reregister', 'load']);
  });
});
