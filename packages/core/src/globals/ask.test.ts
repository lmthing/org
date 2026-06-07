import { describe, it, expect } from 'vitest';
import { createAskGlobal } from './ask.js';
import type { YieldRequest } from '../eval/yield.js';
import type { RenderHost } from '../session/types.js';

/**
 * Unit coverage for the ask() global's descriptor validation + yield wiring.
 * ask() rejects synchronously for bad input (so the turn loop never even sees a
 * yield), and pushes a single 'ask' yield for any safe JSX descriptor.
 */

const silentHost: RenderHost = { display: () => {}, ask: async () => undefined, log: () => {} };

/** Build an ask() bound to a fresh yield sink, returning both. */
function makeAsk(): { ask: (d: unknown) => Promise<unknown>; yields: YieldRequest[] } {
  const yields: YieldRequest[] = [];
  const ask = createAskGlobal((req) => yields.push(req), silentHost);
  return { ask, yields };
}

const descriptor = (type: string, props: Record<string, unknown> = {}): unknown => ({
  type,
  props,
  children: [],
});

describe('ask() global', () => {
  it('pushes a single ask yield for a safe input descriptor', () => {
    const { ask, yields } = makeAsk();
    void ask(descriptor('input', { label: 'name?' }));
    expect(yields).toHaveLength(1);
    expect(yields[0]!.kind).toBe('ask');
    // args = [id, descriptor]; the descriptor is forwarded untouched.
    expect((yields[0]!.args[1] as { type: string }).type).toBe('input');
    expect(typeof yields[0]!.args[0]).toBe('string'); // a generated id
  });

  it('accepts a component descriptor (a custom form element) and yields', () => {
    const { ask, yields } = makeAsk();
    void ask(descriptor('NameForm'));
    expect(yields).toHaveLength(1);
    expect(yields[0]!.kind).toBe('ask');
  });

  it('rejects a non-descriptor argument and pushes no yield', async () => {
    const { ask, yields } = makeAsk();
    await expect(ask('just a string')).rejects.toThrow(/must be a JSX descriptor/);
    expect(yields).toHaveLength(0);
  });

  it('rejects blocked descriptor types (script/iframe) without yielding', async () => {
    for (const blocked of ['script', 'iframe', 'object', 'embed']) {
      const { ask, yields } = makeAsk();
      await expect(ask(descriptor(blocked))).rejects.toThrow(/blocked descriptor type/);
      expect(yields).toHaveLength(0);
    }
  });

  it('rejects dangerouslySetInnerHTML', async () => {
    const { ask } = makeAsk();
    await expect(ask(descriptor('div', { dangerouslySetInnerHTML: { __html: 'x' } }))).rejects.toThrow(
      /dangerouslySetInnerHTML/,
    );
  });

  it('rejects javascript: URLs in props', async () => {
    const { ask } = makeAsk();
    await expect(ask(descriptor('a', { href: 'javascript:alert(1)' }))).rejects.toThrow(
      /javascript: URL not allowed/,
    );
  });

  it('validates nested children too (a blocked child rejects the whole tree)', async () => {
    const { ask, yields } = makeAsk();
    const tree = { type: 'div', props: {}, children: [descriptor('script')] };
    await expect(ask(tree)).rejects.toThrow(/blocked descriptor type/);
    expect(yields).toHaveLength(0);
  });
});
