import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Space } from './space.js';

function makeTrace() {
  return {
    write: vi.fn(),
    readSuffix: vi.fn().mockReturnValue([]),
  };
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'spaces-test-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('Space', () => {
  describe('Space.current()', () => {
    it('creates space at session-{id}/space/', async () => {
      const sessionDir = join(tmpDir, 'session-abc123');
      await mkdir(sessionDir, { recursive: true });
      const trace = makeTrace();

      const space = Space.current({ sessionDir, trace: trace as never });

      expect(space.name).toBe('session-abc123');
      const handle = await space.load();
      expect(handle.name).toBe('session-abc123');
    });
  });

  describe('addFunction()', () => {
    it('writes file to functions/ and emits trace', async () => {
      const sessionDir = join(tmpDir, 'session-fn');
      await mkdir(sessionDir, { recursive: true });
      const trace = makeTrace();

      const space = new Space('test-space', { sessionDir, trace: trace as never });

      space.addFunction('myHelper', 'function myHelper(x: number) { return x * 2; }');

      // Give async operations a chance to complete
      await new Promise((r) => setTimeout(r, 50));

      const fnPath = join(sessionDir, 'space', 'functions', 'myHelper.ts');
      const content = await readFile(fnPath, 'utf-8');
      expect(content).toContain('myHelper');

      const traceCall = trace.write.mock.calls.find(
        (c) => (c[0] as Record<string, unknown>).method === 'addFunction',
      );
      expect(traceCall).toBeDefined();
    });
  });

  describe('addViewComponent()', () => {
    it('writes to components/view/', async () => {
      const sessionDir = join(tmpDir, 'session-view');
      await mkdir(sessionDir, { recursive: true });
      const trace = makeTrace();

      const space = new Space('test-space', { sessionDir, trace: trace as never });
      space.addViewComponent('MyChart', 'const MyChart = () => <div>chart</div>;');

      await new Promise((r) => setTimeout(r, 50));

      const filePath = join(sessionDir, 'space', 'components', 'view', 'MyChart.tsx');
      const content = await readFile(filePath, 'utf-8');
      expect(content).toContain('MyChart');
    });
  });

  describe('addFormComponent()', () => {
    it('writes to components/form/', async () => {
      const sessionDir = join(tmpDir, 'session-form');
      await mkdir(sessionDir, { recursive: true });
      const trace = makeTrace();

      const space = new Space('test-space', { sessionDir, trace: trace as never });
      space.addFormComponent('ContactForm', 'const ContactForm = ({ submit }) => <form></form>;');

      await new Promise((r) => setTimeout(r, 50));

      const filePath = join(sessionDir, 'space', 'components', 'form', 'ContactForm.tsx');
      const content = await readFile(filePath, 'utf-8');
      expect(content).toContain('ContactForm');
    });
  });

  describe('read()', () => {
    it('reads a space file', async () => {
      const sessionDir = join(tmpDir, 'session-read');
      await mkdir(join(sessionDir, 'space', 'functions'), { recursive: true });
      const trace = makeTrace();

      const testContent = 'function hello() { return 42; }';
      await writeFile(join(sessionDir, 'space', 'functions', 'hello.ts'), testContent, 'utf-8');

      const space = new Space('test-space', { sessionDir, trace: trace as never });
      const result = await space.read('functions/hello.ts');

      expect(result).toBe(testContent);
    });
  });

  describe('write()', () => {
    it('writes arbitrary file in space', async () => {
      const sessionDir = join(tmpDir, 'session-write');
      await mkdir(sessionDir, { recursive: true });
      const trace = makeTrace();

      const space = new Space('test-space', { sessionDir, trace: trace as never });
      await space.write('functions/util.ts', 'export const PI = 3.14;');

      const content = await readFile(join(sessionDir, 'space', 'functions', 'util.ts'), 'utf-8');
      expect(content).toBe('export const PI = 3.14;');
    });
  });

  describe('patch()', () => {
    it('replaces text in existing file', async () => {
      const sessionDir = join(tmpDir, 'session-patch');
      await mkdir(join(sessionDir, 'space', 'functions'), { recursive: true });
      const trace = makeTrace();

      const original = 'function add(a, b) { return a + b; }';
      await writeFile(join(sessionDir, 'space', 'functions', 'add.ts'), original, 'utf-8');

      const space = new Space('test-space', { sessionDir, trace: trace as never });
      await space.patch('functions/add.ts', 'a + b', 'a - b');

      const content = await readFile(join(sessionDir, 'space', 'functions', 'add.ts'), 'utf-8');
      expect(content).toBe('function add(a, b) { return a - b; }');
    });
  });

  describe('list()', () => {
    it('returns file names in a directory', async () => {
      const sessionDir = join(tmpDir, 'session-list');
      await mkdir(join(sessionDir, 'space', 'functions'), { recursive: true });
      const trace = makeTrace();

      await writeFile(join(sessionDir, 'space', 'functions', 'foo.ts'), '', 'utf-8');
      await writeFile(join(sessionDir, 'space', 'functions', 'bar.ts'), '', 'utf-8');

      const space = new Space('test-space', { sessionDir, trace: trace as never });
      const files = await space.list('functions');

      expect(files).toContain('foo.ts');
      expect(files).toContain('bar.ts');
    });
  });

  describe('remove()', () => {
    it('deletes a file and emits trace', async () => {
      const sessionDir = join(tmpDir, 'session-remove');
      await mkdir(join(sessionDir, 'space', 'functions'), { recursive: true });
      const trace = makeTrace();

      await writeFile(join(sessionDir, 'space', 'functions', 'toDelete.ts'), 'x', 'utf-8');

      const space = new Space('test-space', { sessionDir, trace: trace as never });
      await space.remove('functions/toDelete.ts');

      const files = await space.list('functions');
      expect(files).not.toContain('toDelete.ts');

      const removeCall = trace.write.mock.calls.find(
        (c) => (c[0] as Record<string, unknown>).type === 'space_file_remove',
      );
      expect(removeCall).toBeDefined();
    });
  });

  describe('generateDtsOverlay()', () => {
    it('returns TypeScript declarations for space entries', async () => {
      const sessionDir = join(tmpDir, 'session-dts');
      await mkdir(sessionDir, { recursive: true });
      const trace = makeTrace();

      const space = new Space('my-space', { sessionDir, trace: trace as never });
      const handle = await space.load();

      handle.functions['myFunc'] = 'function myFunc() {}';
      handle.components['MyView'] = { kind: 'view' };
      handle.components['MyForm'] = { kind: 'form' };

      const dts = space.generateDtsOverlay();

      expect(dts).toContain('// === Space: my-space ===');
      expect(dts).toContain('declare function myFunc');
      expect(dts).toContain('declare const MyView');
      expect(dts).toContain('declare const MyForm');
    });
  });

  describe('class deletion cascade', () => {
    it('processClassDeletion nullifies orphan-placeholder vars', () => {
      const sessionDir = join(tmpDir, 'session-cascade');
      const trace = makeTrace();

      const space = new Space('test-space', { sessionDir, trace: trace as never });

      const scope: Record<string, unknown> = {
        myInstance: { __orphaned: 'MyClass', someField: 'value' },
        otherInstance: { __orphaned: 'OtherClass', data: 42 },
        plainVar: 'hello',
      };

      space.processClassDeletion('MyClass', scope);

      expect(scope['myInstance']).toBeNull();
      expect(scope['otherInstance']).toEqual({ __orphaned: 'OtherClass', data: 42 }); // untouched
      expect(scope['plainVar']).toBe('hello'); // untouched

      const nullifiedCall = trace.write.mock.calls.find(
        (c) => (c[0] as Record<string, unknown>).type === 'class_instance_nullified',
      );
      expect(nullifiedCall).toBeDefined();
      expect((nullifiedCall![0] as Record<string, unknown>)['variable']).toBe('myInstance');
    });
  });

  describe('loadFunction()', () => {
    it('returns stub placeholder when expand is not set', async () => {
      const sessionDir = join(tmpDir, 'session-loadfn');
      await mkdir(sessionDir, { recursive: true });
      const trace = makeTrace();

      const space = new Space('test-space', { sessionDir, trace: trace as never });
      const handle = await space.load();

      handle.loadFunction('MyClass');

      const stub = handle.functions['MyClass'] as string;
      expect(stub).toContain('collapsed class');
      expect(stub).toContain('MyClass');
    });

    it('marks function as expanded when expand: true', async () => {
      const sessionDir = join(tmpDir, 'session-loadfn-expand');
      await mkdir(sessionDir, { recursive: true });
      const trace = makeTrace();

      const space = new Space('test-space', { sessionDir, trace: trace as never });
      const handle = await space.load();

      handle.loadFunction('MyClass', { expand: true });

      const expanded = handle.functions['MyClass'] as string;
      expect(expanded).toContain('expanded');
    });
  });
});
