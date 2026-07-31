import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { Session } from './session.js';
import { createMockStreamFn } from '../testing/mock-provider.js';
import type { RenderHost } from './types.js';
import type { StreamOpts } from '../eval/stream-types.js';

/**
 * The TOP-LEVEL session honors the running agent's frontmatter `model:` — the same rule
 * the delegate path has always applied (`delegate/delegate.ts` `runDelegate`:
 * `agent.model ?? opts.model`). Before this, a `model:` on an agent took effect only when
 * that agent was delegated TO, so a space could not pin itself to a strong model while the
 * pod default stayed small.
 *
 * Precedence: `agent.model ?? opts.modelAlias`.
 */

const tmpDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
});

/** One-agent space whose instruct.md carries the given frontmatter (empty = none). */
async function makeSpace(frontmatter: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lmthing-sessionmodel-'));
  tmpDirs.push(dir);
  const file = join(dir, 'agents', 'main', 'instruct.md');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${frontmatter}You are a test agent.\n`, 'utf8');
  return dir;
}

const silentHost: RenderHost = { display: () => {}, ask: async () => undefined, log: () => {} };

/** Start a session in `spaceDir` with `modelAlias`, returning the model of every LLM call. */
async function modelsSeen(spaceDir: string, modelAlias: string): Promise<Array<string | undefined>> {
  const seen: Array<string | undefined> = [];
  const streamFn = createMockStreamFn((o: StreamOpts, ctx) => {
    seen.push(o.model);
    return ctx.callIndex === 0 ? `display("ok");` : '';
  });
  const session = new Session(
    { spaceDir, agentSlug: 'default', modelAlias, renderHost: silentHost, systemSpaceDirs: [] },
    { streamFn },
  );
  try {
    await session.start('do the thing');
  } finally {
    session.dispose();
  }
  return seen;
}

describe('Session model selection — agent frontmatter `model:`', () => {
  it("runs the top-level turn on the AGENT's model when its frontmatter declares one", async () => {
    const dir = await makeSpace('---\nmodel: agent-model\n---\n\n');
    const seen = await modelsSeen(dir, 'session-default');
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen)).toEqual(new Set(['agent-model']));
  });

  it('falls back to the session default when the agent declares no model', async () => {
    const dir = await makeSpace('');
    const seen = await modelsSeen(dir, 'session-default');
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen)).toEqual(new Set(['session-default']));
  });

  it("makes the agent's model the session's effective default for forks too", async () => {
    // The fork engine's `defaultModel` is the session's EFFECTIVE model, so a fork that
    // declares nothing follows the running agent rather than the raw pod default. (More
    // specific sources — a task's `model:`, a role model, a delegate target's own
    // frontmatter — still win their own precedence chain, see fork.ts / delegate.ts.)
    const dir = await makeSpace('---\nmodel: agent-model\n---\n\n');
    const session = new Session(
      { spaceDir: dir, agentSlug: 'default', modelAlias: 'session-default', renderHost: silentHost, systemSpaceDirs: [] },
      { streamFn: createMockStreamFn((_o, ctx) => (ctx.callIndex === 0 ? `display("ok");` : '')) },
    );
    try {
      await session.start('do the thing');
      const engine = await (session as unknown as {
        getForkEngine: () => Promise<{ opts: { defaultModel?: string } }>;
      }).getForkEngine();
      expect(engine.opts.defaultModel).toBe('agent-model');
    } finally {
      session.dispose();
    }
  });
});
