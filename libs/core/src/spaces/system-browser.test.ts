import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { loadSpace } from './load.js';
import { transpileStatement } from '../typecheck/transpile.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BROWSER_DIR = join(__dirname, '..', '..', 'system-spaces', 'system-browser');

// The full Lightpanda tool catalog migrated into the space (src/browser/tools.zig Tool enum).
const TOOL_NAMES = [
  'goto', 'search', 'markdown', 'html', 'links', 'evaluate', 'extract', 'tree', 'nodeDetails',
  'interactiveElements', 'structuredData', 'detectForms', 'click', 'fill', 'scroll', 'waitForSelector',
  'waitForScript', 'waitForState', 'hover', 'press', 'selectOption', 'setChecked', 'findElement',
  'consoleLogs', 'getUrl', 'getCookies', 'getEnv',
];

describe('system-browser space', () => {
  it('loads without throwing (agent function/knowledge refs all resolve)', async () => {
    const space = await loadSpace(BROWSER_DIR);
    expect(space).toBeDefined();
    expect(space.agents['browser']).toBeDefined();
  });

  it('ships one function per Lightpanda tool', async () => {
    const space = await loadSpace(BROWSER_DIR);
    for (const name of TOOL_NAMES) {
      expect(space.functions[name], `missing browser function ${name}`).toBeDefined();
    }
    // No stray extra functions beyond the migrated catalog.
    expect(Object.keys(space.functions).sort()).toEqual([...TOOL_NAMES].sort());
  });

  it('each function forwards a JSON-RPC tools/call to the LIGHTPANDA_MCP_URL endpoint', async () => {
    const space = await loadSpace(BROWSER_DIR);
    for (const name of TOOL_NAMES) {
      const src = space.functions[name]!;
      expect(src, `${name} should call tools/call`).toContain("method: 'tools/call'");
      expect(src, `${name} should name itself as the tool`).toContain(`name: '${name}'`);
      expect(src, `${name} should read the endpoint from env`).toContain("process.env['LIGHTPANDA_MCP_URL']");
    }
  });

  it('the browser agent grants every tool + the driving knowledge', async () => {
    const space = await loadSpace(BROWSER_DIR);
    const agent = space.agents['browser']!;
    for (const name of TOOL_NAMES) {
      expect(agent.config.functions, `agent must grant ${name}`).toContain(name);
    }
    // Knowledge is attached at the agent level (nodes can't carry knowledge).
    expect(agent.config.knowledge).toContain('browser/driving');
    expect(space.knowledge.domains['browser']).toBeDefined();
  });

  it('the driving knowledge field exposes the browserDriving variable', async () => {
    const space = await loadSpace(BROWSER_DIR);
    const domain = space.knowledge.domains['browser']!;
    const field = domain.fields['driving'];
    expect(field?.variableName).toBe('browserDriving');
    expect(Object.keys(field?.options ?? {})).toEqual(expect.arrayContaining(['setup', 'replay-scripts']));
  });

  // Behavioral: run a real wrapper's transpiled source against a stubbed, sandbox-shaped
  // `fetch` (sync .json()/.text() accessors, as resolveFetchYield returns) + `process`.
  async function loadWrapper(name: string, fetchStub: unknown, env: Record<string, string> = {}) {
    const space = await loadSpace(BROWSER_DIR);
    const js = transpileStatement(space.functions[name]!).replace(/\bexport\s+/g, '');
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const factory = new Function('fetch', 'process', `${js}\nreturn ${name};`);
    return factory(fetchStub, { env }) as (...a: unknown[]) => Promise<{ ok: boolean; text: string; isError: boolean; error?: string }>;
  }

  it('extract() builds the request and parses a text-content result', async () => {
    let captured: { url: string; body: unknown } | undefined;
    const fetchStub = async (url: string, init: { body: string }) => {
      captured = { url, body: JSON.parse(init.body) };
      return {
        ok: true,
        status: 200,
        json: () => ({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: '{"karma":"42"}' }] } }),
        text: () => '',
      };
    };
    const extract = await loadWrapper('extract', fetchStub, { LIGHTPANDA_MCP_URL: 'http://lp:9999' });
    const r = await extract({ schema: '{"karma":"#karma"}' });
    expect(captured!.url).toBe('http://lp:9999');
    expect(captured!.body).toMatchObject({ method: 'tools/call', params: { name: 'extract', arguments: { schema: '{"karma":"#karma"}' } } });
    expect(r).toEqual({ ok: true, text: '{"karma":"42"}', isError: false });
  });

  it('defaults the endpoint to localhost:9223 and reports an unreachable browser', async () => {
    const fetchStub = async () => { throw new Error('ECONNREFUSED'); };
    const goto = await loadWrapper('goto', fetchStub, {});
    const r = await goto({ url: 'https://example.com' });
    expect(r.ok).toBe(false);
    expect(r.isError).toBe(true);
    expect(r.error).toContain('127.0.0.1:9223');
    expect(r.error).toContain('unreachable');
  });

  it('surfaces a page-level MCP isError result as ok:false without throwing', async () => {
    const fetchStub = async () => ({
      ok: true,
      status: 200,
      json: () => ({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'boom' }], isError: true } }),
      text: () => '',
    });
    const click = await loadWrapper('click', fetchStub, {});
    const r = await click({ selector: '#go' });
    expect(r).toEqual({ ok: false, text: 'boom', isError: true });
  });

  it('surfaces a JSON-RPC protocol error', async () => {
    const fetchStub = async () => ({
      ok: true,
      status: 200,
      json: () => ({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'bad params' } }),
      text: () => '',
    });
    const tree = await loadWrapper('tree', fetchStub, {});
    const r = await tree({});
    expect(r.ok).toBe(false);
    expect(r.error).toBe('bad params');
  });
});
