import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  startZerostackEndpoint, mapProvider, renderConfigToml,
  ZEROSTACK_ENV, type ZerostackEndpoint,
} from './zerostack-endpoint.js';

let endpoint: ZerostackEndpoint | undefined;
let dataDir: string;

/**
 * A stand-in for the real Rust binary. Every test that exercises a TURN needs the child process to
 * be REAL — the bridge's whole job is spawning one, capturing its output, and mapping its exit
 * code, and a mocked spawn would test none of that.
 *
 * It records the argv it was invoked with so the tests can assert on flags that are otherwise
 * invisible: `-p` vs `-c`, the `--` guard before the message, the loop flags.
 */
function fakeZerostack(dir: string, body: string): string {
  const path = join(dir, 'fake-zerostack');
  writeFileSync(path, `#!/usr/bin/env node\n${body}\n`, 'utf8');
  chmodSync(path, 0o755);
  return path;
}

/** Records argv to a file next to itself, prints a fixed answer, exits 0. */
const RECORDER = `
const fs = require('node:fs');
const argv = process.argv.slice(2);
if (argv[0] === '--version') { console.log('zerostack 1.7.2'); process.exit(0); }
fs.appendFileSync(process.env.ZS_ARGV_LOG, JSON.stringify({ argv, cwd: process.cwd(), xdg: process.env.XDG_DATA_HOME }) + '\\n');
console.log('fixed answer');
process.exit(0);
`;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'zs-endpoint-'));
});

afterEach(async () => {
  await endpoint?.close();
  endpoint = undefined;
  delete process.env['LMTHING_ZEROSTACK_BIN'];
  delete process.env['ZS_ARGV_LOG'];
  rmSync(dataDir, { recursive: true, force: true });
});

const post = async (url: string, body: unknown): Promise<Record<string, unknown>> => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await res.json()) as Record<string, unknown>;
};

describe('mapProvider', () => {
  it('maps lmthingcloud onto an OpenAI-compatible custom provider, so spend lands on the same key', () => {
    const m = mapProvider('lmthingcloud:DeepSeek-V4-Pro', { LMTHINGCLOUD_BASE_URL: 'https://x.test/v1' });
    expect(m).toMatchObject({ ok: true, model: 'DeepSeek-V4-Pro', baseUrl: 'https://x.test/v1', apiKeyEnv: 'LMTHINGCLOUD_API_KEY' });
  });

  it('defaults the lmthingcloud base URL when the env var is unset', () => {
    const m = mapProvider('lmthingcloud:Kimi-K2.6', {});
    expect(m).toMatchObject({ ok: true, baseUrl: 'https://lmthing.cloud/v1' });
  });

  /**
   * The load-bearing one. zerostack's OWN default provider is OpenRouter, so a silent fallback here
   * would bill a completely different account — or fail deep inside the child complaining about a
   * key nobody set. Refusing is the only honest answer.
   */
  it('REFUSES a provider with no OpenAI-compatible endpoint rather than falling back', () => {
    const m = mapProvider('azure:gpt-5.5', {});
    expect(m.ok).toBe(false);
    if (!m.ok) expect(m.reason).toMatch(/lmthingcloud/);
  });

  it('rejects a spec that is not provider:modelId', () => {
    expect(mapProvider('M', {}).ok).toBe(false);
    expect(mapProvider('openai:', {}).ok).toBe(false);
  });
});

describe('renderConfigToml', () => {
  it('pins yolo — the only mode that works with no terminal attached', () => {
    const toml = renderConfigToml({ providerName: 'lmthing', model: 'm', baseUrl: 'https://x.test/v1', apiKeyEnv: 'K', dataDir: '/data/.lmthing' });
    // Any "ask" mode would block on a prompt nothing can answer and surface as a mystery stall.
    expect(toml).toContain('default_permission_mode = "yolo"');
  });

  it('confines the file tools to the data directory', () => {
    const toml = renderConfigToml({ providerName: 'lmthing', model: 'm', baseUrl: 'https://x.test/v1', apiKeyEnv: 'K', dataDir: '/data/.lmthing' });
    expect(toml).toContain('[permission.external_directory]');
    expect(toml).toContain('"/data/.lmthing/**" = "allow"');
    expect(toml).toContain('"/**" = "deny"');
  });

  /**
   * Upstream ships Exa / Context7 / grep.app MCP servers ON by default, and a live run confirmed
   * the Exa one opens a session even with no EXA_API_KEY set. Inside a pod that is pure data
   * egress from the person's entire data directory, to accounts nobody configured.
   */
  it('turns OFF every default third-party MCP server — they are data egress', () => {
    const toml = renderConfigToml({ providerName: 'lmthing', model: 'm', baseUrl: 'https://x.test/v1', apiKeyEnv: 'K', dataDir: '/d' });
    // The load-bearing one: the three defaults apply only while this key is UNSET, so an explicit
    // empty map is what stops a FOURTH default appearing in some later upstream release.
    expect(toml).toContain('mcp_servers = {}');
    // Belt and braces — each default also refused by name, in case an empty map stops overriding.
    expect(toml).toContain('enable-exa-mcp = false');
    expect(toml).toContain('enable-context7-mcp = false');
    expect(toml).toContain('enable-grepapp-mcp = false');
    expect(toml).toContain('allow_all_mcp_calls = false');
  });

  /** TOML is positional: a top-level key after the first [table] header silently joins that table. */
  it('puts every top-level key BEFORE the first table header', () => {
    const toml = renderConfigToml({ providerName: 'lmthing', model: 'm', baseUrl: 'https://x.test/v1', apiKeyEnv: 'K', dataDir: '/d' });
    const firstHeader = toml.indexOf('[custom_providers.');
    for (const key of ['provider =', 'model =', 'default_permission_mode =', 'mcp_servers =', 'enable-exa-mcp =', 'allow_all_mcp_calls =']) {
      expect(toml.indexOf(key), `${key} must precede the first [table]`).toBeLessThan(firstHeader);
    }
  });

  it('names the api key by ENV VAR, never inlining the secret', () => {
    const toml = renderConfigToml({ providerName: 'lmthing', model: 'm', baseUrl: 'https://x.test/v1', apiKeyEnv: 'LMTHINGCLOUD_API_KEY', dataDir: '/d' });
    expect(toml).toContain('api_key_env = "LMTHINGCLOUD_API_KEY"');
  });
});

describe('the loopback zerostack endpoint', () => {
  it('publishes LMTHING_ZEROSTACK_URL — the whole integration for the space functions', async () => {
    endpoint = await startZerostackEndpoint({ dataDir, modelSpec: 'lmthingcloud:m' });
    expect(process.env[ZEROSTACK_ENV]).toBe(endpoint.url);
    expect(endpoint.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  /**
   * Publishing the URL even with no binary is deliberate: an UNSET variable makes every space
   * function report the same uninformative "not configured", while a reachable endpoint can say
   * which of the two things is actually wrong.
   */
  it('still publishes the URL when the binary is missing, and says so in status', async () => {
    process.env['LMTHING_ZEROSTACK_BIN'] = join(dataDir, 'does-not-exist');
    endpoint = await startZerostackEndpoint({ dataDir, modelSpec: 'lmthingcloud:m' });
    expect(process.env[ZEROSTACK_ENV]).toBe(endpoint.url);
    expect(endpoint.bin).toBeNull();

    const status = await post(endpoint.url, { op: 'status' });
    expect(status['ok']).toBe(false);
    expect(status['installed']).toBe(false);
    expect(String(status['error'])).toMatch(/not installed/);
  });

  it('reports an unusable model in status instead of running against the wrong account', async () => {
    process.env['LMTHING_ZEROSTACK_BIN'] = fakeZerostack(dataDir, RECORDER);
    endpoint = await startZerostackEndpoint({ dataDir, modelSpec: 'azure:gpt-5.5' });
    const status = await post(endpoint.url, { op: 'status' });
    expect(status['installed']).toBe(true);
    expect(status['ok']).toBe(false);
    expect(String(status['error'])).toMatch(/no OpenAI-compatible endpoint/);
  });

  it('writes the primer zerostack reads, on EVERY boot', async () => {
    // Rewritten each boot because a pod volume outlives the image: a primer from an older runtime
    // would otherwise persist unnoticed across an upgrade.
    writeFileSync(join(dataDir, 'AGENTS.md'), 'stale from an older image', 'utf8');
    endpoint = await startZerostackEndpoint({ dataDir, modelSpec: 'lmthingcloud:m' });
    const md = readFileSync(join(dataDir, 'AGENTS.md'), 'utf8');
    expect(md).not.toMatch(/stale from an older image/);
    // The two rules a fix silently reverts without: generated files, and the re-materialized tree.
    expect(md).toMatch(/types\/generated\.d\.ts/);
    expect(md).toMatch(/system\/spaces/);
    // AGENTS.md is the CONTRACT; the formats live in ARCHITECTURE.md and must not be duplicated.
    expect(md).toMatch(/ARCHITECTURE\.md/);
  });

  /**
   * Its ABSENCE is a prompt — "No ARCHITECTURE.md found … Create one? [y/N]" — asked even under
   * `-p`. Nothing can answer it here, so the file has to exist before the first turn.
   */
  it('writes ARCHITECTURE.md too, so zerostack never asks to create one', async () => {
    endpoint = await startZerostackEndpoint({ dataDir, modelSpec: 'lmthingcloud:m' });
    const md = readFileSync(join(dataDir, 'ARCHITECTURE.md'), 'utf8');
    expect(md).toMatch(/LMThing data root/);
    expect(md).toMatch(/AGENTS\.md/);
  });

  /**
   * The reference has to actually carry the unguessable facts, or zerostack rediscovers them
   * badly. Each of these is a rule a competent engineer would otherwise get wrong by default.
   */
  it('teaches ARCHITECTURE.md the facts that are not guessable from the files', async () => {
    endpoint = await startZerostackEndpoint({ dataDir, modelSpec: 'lmthingcloud:m' });
    const md = readFileSync(join(dataDir, 'ARCHITECTURE.md'), 'utf8');
    expect(md, 'what LMThing is').toMatch(/compute pod/);
    expect(md, 'api filenames ARE the method').toMatch(/GET\.ts/);
    expect(md, 'ctx.db is async and fails silently').toMatch(/missing `await`/);
    expect(md, 'a page is a spec, not TSX').toMatch(/\.view\.json/);
    expect(md, 'the closed section vocabulary').toMatch(/timeline/);
    expect(md, 'db events are source-qualified').toMatch(/project\/db\./);
    expect(md, 'space loads are all-or-nothing').toMatch(/frontmatter/);
    expect(md, 'space functions have no fs').toMatch(/child_process/);
    expect(md, 'how to typecheck an app').toMatch(/tsc --noEmit/);
    expect(md, 'the design-token gate').toMatch(/var\(--foreground\)/);
  });

  it('writes config.toml under the data dir so sessions survive a scale-to-zero wake', async () => {
    endpoint = await startZerostackEndpoint({ dataDir, modelSpec: 'lmthingcloud:DeepSeek-V4-Pro' });
    const cfg = readFileSync(join(dataDir, '.zerostack', 'config', 'config.toml'), 'utf8');
    expect(cfg).toContain('model = "DeepSeek-V4-Pro"');
  });

  describe('turns', () => {
    beforeEach(() => {
      process.env['ZS_ARGV_LOG'] = join(dataDir, 'argv.log');
      process.env['LMTHING_ZEROSTACK_BIN'] = fakeZerostack(dataDir, RECORDER);
    });

    const argvLines = (): Array<{ argv: string[]; cwd: string; xdg: string }> =>
      readFileSync(join(dataDir, 'argv.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

    it('runs a first turn WITHOUT -c and returns a session id', async () => {
      endpoint = await startZerostackEndpoint({ dataDir, modelSpec: 'lmthingcloud:m' });
      const r = await post(endpoint.url, { op: 'ask', message: 'fix the thing' });

      expect(r['ok']).toBe(true);
      expect(r['text']).toBe('fixed answer');
      expect(String(r['sessionId'])).toMatch(/^[0-9a-f-]{36}$/);

      const [line] = argvLines();
      // `-c` on a fresh data dir asks zerostack to continue a session that does not exist yet.
      expect(line!.argv).not.toContain('-c');
      expect(line!.argv).toContain('-p');
      // The message is POSITIONAL (`-p` is the print-and-exit flag), and `--` keeps a message
      // starting with `-` from being parsed as options.
      expect(line!.argv.slice(-2)).toEqual(['--', 'fix the thing']);
    });

    it('runs the child in the DATA DIRECTORY — that is the whole grant', async () => {
      endpoint = await startZerostackEndpoint({ dataDir, modelSpec: 'lmthingcloud:m' });
      await post(endpoint.url, { op: 'ask', message: 'x' });
      // realpath: macOS resolves /var → /private/var under tmpdir().
      expect(existsSync(argvLines()[0]!.cwd)).toBe(true);
      expect(argvLines()[0]!.cwd).toMatch(/zs-endpoint-/);
    });

    /**
     * The session model in one assertion. zerostack mints its own ids and `--session` loads by
     * PREFIX, so the bridge gives each logical session its own XDG_DATA_HOME — with exactly one
     * session in that directory, `-c` is unambiguous by construction and the id stays ours.
     */
    it('resumes with -c in the SAME per-session data dir', async () => {
      endpoint = await startZerostackEndpoint({ dataDir, modelSpec: 'lmthingcloud:m' });
      const first = await post(endpoint.url, { op: 'ask', message: 'one' });
      const id = String(first['sessionId']);

      const second = await post(endpoint.url, { op: 'ask', message: 'two', sessionId: id });
      expect(second['sessionId']).toBe(id);

      const lines = argvLines();
      expect(lines[1]!.argv).toContain('-c');
      // Same conversation ⇒ same store. If these ever diverge, a "resume" silently starts over.
      expect(lines[1]!.xdg).toBe(lines[0]!.xdg);
      expect(lines[1]!.xdg).toContain(id);
    });

    it('refuses an unknown session id rather than silently starting a new conversation', async () => {
      endpoint = await startZerostackEndpoint({ dataDir, modelSpec: 'lmthingcloud:m' });
      const r = await post(endpoint.url, { op: 'ask', message: 'x', sessionId: 'nope' });
      expect(r['ok']).toBe(false);
      expect(String(r['error'])).toMatch(/no zerostack session/);
    });

    it('passes the loop flags, which the lite binary would reject', async () => {
      endpoint = await startZerostackEndpoint({ dataDir, modelSpec: 'lmthingcloud:m' });
      await post(endpoint.url, { op: 'loop', message: 'make it typecheck', validateCmd: 'tsc --noEmit', maxIterations: 3 });
      const { argv } = argvLines()[0]!;
      expect(argv).toContain('--loop');
      expect(argv).toContain('--loop-run');
      expect(argv[argv.indexOf('--loop-run') + 1]).toBe('tsc --noEmit');
      expect(argv[argv.indexOf('--loop-max') + 1]).toBe('3');
    });

    it('lists sessions newest-first', async () => {
      endpoint = await startZerostackEndpoint({ dataDir, modelSpec: 'lmthingcloud:m' });
      await post(endpoint.url, { op: 'ask', message: 'a' });
      const list = await post(endpoint.url, { op: 'sessions' });
      expect(list['ok']).toBe(true);
      expect((list['sessions'] as unknown[]).length).toBe(1);
    });

    it('surfaces a non-zero exit as an error carrying stderr, not as a silent empty answer', async () => {
      process.env['LMTHING_ZEROSTACK_BIN'] = fakeZerostack(dataDir, `
        if (process.argv[2] === '--version') { console.log('zerostack 1.7.2'); process.exit(0); }
        console.error('provider rejected the key');
        process.exit(3);
      `);
      endpoint = await startZerostackEndpoint({ dataDir, modelSpec: 'lmthingcloud:m' });
      const r = await post(endpoint.url, { op: 'ask', message: 'x' });
      expect(r['ok']).toBe(false);
      expect(r['exitCode']).toBe(3);
      expect(String(r['error'])).toMatch(/provider rejected the key/);
    });

    /**
     * A timed-out turn is neither a success nor a clean failure: zerostack has usually already
     * edited files. Returning the partial text and saying so is what lets the caller resume
     * instead of starting over on top of half-applied edits.
     */
    it('marks a timeout, and still returns the partial output', async () => {
      process.env['LMTHING_ZEROSTACK_BIN'] = fakeZerostack(dataDir, `
        if (process.argv[2] === '--version') { console.log('zerostack 1.7.2'); process.exit(0); }
        console.log('got this far');
        setTimeout(() => {}, 60000);
      `);
      endpoint = await startZerostackEndpoint({ dataDir, modelSpec: 'lmthingcloud:m' });
      const r = await post(endpoint.url, { op: 'ask', message: 'x', timeoutMs: 400 });
      expect(r['timedOut']).toBe(true);
      expect(r['ok']).toBe(false);
      expect(r['text']).toContain('got this far');
      expect(String(r['error'])).toMatch(/already made are on disk/);
    }, 20_000);

    it('refuses a second concurrent turn on one session rather than queueing it', async () => {
      process.env['LMTHING_ZEROSTACK_BIN'] = fakeZerostack(dataDir, `
        const fs = require('node:fs');
        if (process.argv[2] === '--version') { console.log('zerostack 1.7.2'); process.exit(0); }
        fs.appendFileSync(process.env.ZS_ARGV_LOG, JSON.stringify({ argv: [], cwd: '', xdg: '' }) + '\\n');
        setTimeout(() => { console.log('done'); process.exit(0); }, 1500);
      `);
      endpoint = await startZerostackEndpoint({ dataDir, modelSpec: 'lmthingcloud:m' });
      const first = post(endpoint.url, { op: 'ask', message: 'slow', timeoutMs: 10_000 });
      // Let the first turn register before racing it.
      await new Promise((r) => setTimeout(r, 300));
      const sessions = await post(endpoint.url, { op: 'sessions' });
      const id = (sessions['sessions'] as Array<{ sessionId: string; busy: boolean }>)[0]!;
      expect(id.busy).toBe(true);

      const second = await post(endpoint.url, { op: 'ask', message: 'x', sessionId: id.sessionId });
      expect(second['ok']).toBe(false);
      expect(String(second['error'])).toMatch(/already has a turn in flight/);
      await first;
    }, 20_000);

    it('cancels an in-flight turn', async () => {
      process.env['LMTHING_ZEROSTACK_BIN'] = fakeZerostack(dataDir, `
        if (process.argv[2] === '--version') { console.log('zerostack 1.7.2'); process.exit(0); }
        setTimeout(() => {}, 60000);
      `);
      endpoint = await startZerostackEndpoint({ dataDir, modelSpec: 'lmthingcloud:m' });
      const pending = post(endpoint.url, { op: 'ask', message: 'slow', timeoutMs: 30_000 });
      await new Promise((r) => setTimeout(r, 300));
      const list = await post(endpoint.url, { op: 'sessions' });
      const id = (list['sessions'] as Array<{ sessionId: string }>)[0]!.sessionId;

      const cancelled = await post(endpoint.url, { op: 'cancel', sessionId: id });
      expect(cancelled['ok']).toBe(true);
      const r = await pending;
      expect(r['ok']).toBe(false);
    }, 20_000);

    it('answers an unknown op with an error rather than hanging the caller', async () => {
      endpoint = await startZerostackEndpoint({ dataDir, modelSpec: 'lmthingcloud:m' });
      const r = await post(endpoint.url, { op: 'nonsense' });
      expect(r['ok']).toBe(false);
      expect(String(r['error'])).toMatch(/unknown zerostack op/);
    });
  });
});
