import { describe, it, expect } from 'vitest';
import { createReadDocumentGlobal, type ReadDocumentResult } from './read-document.js';
import type { YieldRequest } from '../eval/yield.js';

/**
 * Unit coverage for readDocument()'s yield wiring. The global is a thin
 * pass-through: it pushes a single 'readDocument' yield carrying the
 * attachmentId + opts verbatim (host-side documentResolver does the extraction).
 */
function makeReadDocument(): {
  readDocument: (id: string, opts?: { maxChars?: number }) => Promise<ReadDocumentResult>;
  yields: YieldRequest[];
} {
  const yields: YieldRequest[] = [];
  const readDocument = createReadDocumentGlobal((req) => yields.push(req));
  return { readDocument, yields };
}

describe('readDocument() global', () => {
  it('pushes a single readDocument yield with (attachmentId, opts) as args', () => {
    const { readDocument, yields } = makeReadDocument();
    void readDocument('doc-1', { maxChars: 500 });
    expect(yields).toHaveLength(1);
    expect(yields[0]!.kind).toBe('readDocument');
    expect(yields[0]!.args).toEqual(['doc-1', { maxChars: 500 }]);
    expect(yields[0]!.vmPromiseHandle).toBeUndefined();
  });

  it('passes undefined opts through when omitted', () => {
    const { readDocument, yields } = makeReadDocument();
    void readDocument('doc-2');
    expect(yields[0]!.args).toEqual(['doc-2', undefined]);
  });

  it('resolves with the ReadDocumentResult the host injects back', async () => {
    const { readDocument, yields } = makeReadDocument();
    const p = readDocument('doc-3');
    const result: ReadDocumentResult = {
      ok: true,
      attachmentId: 'doc-3',
      mediaType: 'text/plain',
      kind: 'text',
      text: 'the code is BANANA42',
    };
    yields[0]!.deferred.resolve(result);
    await expect(p).resolves.toEqual(result);
  });
});
