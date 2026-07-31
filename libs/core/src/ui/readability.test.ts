import { describe, it, expect } from 'vitest';
import { hasReadableProse } from './readability.js';

/** The JSX the VM's createElement shim produces. */
const el = (type: string, props: Record<string, unknown> | null, ...children: unknown[]) => ({
  type,
  ...(props ? { props } : {}),
  ...(children.length ? { children } : {}),
});

describe('hasReadableProse — the specimens it exists for', () => {
  it('rejects the #office project-state dump verbatim', () => {
    // 22-crossfire run 2 step 3. Rae asked how to track the lift-out fee; this was the
    // WHOLE reply, and the turn settled `done` because display() had fired.
    const descriptor = el(
      'Stack',
      { gap: 2 },
      el('Heading', { level: 2 }, 'Current project state'),
      el('Paragraph', null, 'The project has these tables: ', '["boats","work_items"]'),
      el('Paragraph', null, 'Pages: ', '{"ok":true,"entries":["_layout.tsx","boats","index.tsx"]}'),
      el(
        'Paragraph',
        null,
        'API routes: ',
        '{"ok":true,"entries":["boats-add","boats-detail","boats-list","work-items-add"]}',
      ),
    );
    expect(hasReadableProse(descriptor)).toBe(false);
  });

  it('rejects generated source posted as the answer', () => {
    // 22-crossfire run 2 step 2: ~1800 chars of API handler, in reply to "go on then".
    const code = [
      "import { HttpError } from '@app/runtime';",
      "export const name = 'boats-detail';",
      "export const description = 'Returns one boat by id query parameter.';",
      'export default async function handler(input: Input, ctx: ApiCtx): Promise<Output> {',
      '  const boats = await ctx.db.query(\'boats\');',
      '  if (!boat) {',
      "    throw new HttpError(404, 'Boat not found');",
      '  }',
      '}',
    ].join('\n');
    expect(hasReadableProse(code)).toBe(false);
  });

  it('rejects a bare table/route listing', () => {
    // 20-studio run 2 steps 6 and 9 — what Ana and Rita actually received.
    expect(hasReadableProse('jobs press_checks')).toBe(false);
    expect(hasReadableProse('job-status jobs-get jobs-list press-checks-create statuses')).toBe(false);
  });

  it('rejects a raw value with no text of its own', () => {
    // display(someTable) / display(rows) — legal in /chat, but there is nothing to read,
    // so it earns the nudge rather than a silent `done`.
    expect(hasReadableProse([{ id: 1, name: 'Kittiwake' }])).toBe(false);
    expect(hasReadableProse({ ok: true, entries: ['a', 'b'] })).toBe(false);
    expect(hasReadableProse(undefined)).toBe(false);
    expect(hasReadableProse('')).toBe(false);
  });
});

describe('hasReadableProse — answers it must NOT reject', () => {
  it('accepts the real replies from the same runs', () => {
    // These four are verbatim from channels in 20-studio and 22-crossfire. A guard that
    // fires on any of them is worse than the bug it fixes.
    expect(
      hasReadableProse(
        'I see the yard tracker has four boats but they\'re all placeholder names — Boat 1 through Boat 4. No "Marisol" in the system yet.',
      ),
    ).toBe(true);
    expect(
      hasReadableProse('Got it, Sam. I can see 4 boats in the yard, but none are called "Bright Penny" yet. Which boat is she?'),
    ).toBe(true);
    expect(hasReadableProse("You're at 42 so far — the same number the app shows you.")).toBe(true);
    expect(hasReadableProse(el('Paragraph', null, 'Done — the lift-out fee is now its own field on every job.'))).toBe(true);
  });

  it('accepts prose that QUOTES machine output alongside it', () => {
    // The stripping happens first precisely so this keeps working: an answer is allowed to
    // show the data it is talking about.
    const mixed = el(
      'Stack',
      null,
      el('Paragraph', null, 'Both boats are now in the yard list, and Marisol is flagged as waiting on parts.'),
      el('CodeBlock', { text: '["boats","work_items"]' }),
    );
    expect(hasReadableProse(mixed)).toBe(true);
  });

  it('accepts a short bulleted answer', () => {
    const bullets = ['Kittiwake is quoted and waiting on your call', 'Marisol needs a shaft, three weeks out'].join('\n');
    expect(hasReadableProse(bullets)).toBe(true);
  });

  it('accepts a Table whose rows carry the answer', () => {
    // descriptorToText pulls text-bearing props, so a real Table is not mistaken for a dump.
    const table = el('Table', {
      columns: ['Boat', 'Status'],
      rows: [
        ['Kittiwake', 'quoted, waiting on the owner'],
        ['Marisol', 'waiting on parts, three weeks'],
      ],
    });
    expect(hasReadableProse(table)).toBe(true);
  });
});

describe('hasReadableProse — the stripper itself', () => {
  it('does not treat braces inside a string as structure', () => {
    expect(hasReadableProse('She wrote "a}b" on the invoice and nobody could read it.')).toBe(true);
  });

  it('leaves an unbalanced brace alone rather than eating the rest', () => {
    expect(hasReadableProse('The quote came back at { and then the fax died halfway through.')).toBe(true);
  });

  it('ignores a bare {} that is not a serialization', () => {
    // Too short to be a dump; the sentence around it must survive.
    expect(hasReadableProse('Nothing came back for that job — the response was {} and I could not tell why.')).toBe(true);
  });
});
