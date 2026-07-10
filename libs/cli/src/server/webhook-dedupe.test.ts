import { describe, it, expect, beforeEach } from 'vitest';
import { isDuplicateInbound, clearInboundDedupe } from './webhook-dedupe.js';

describe('isDuplicateInbound', () => {
  beforeEach(() => clearInboundDedupe());

  it('accepts the first occurrence and flags an identical replay', () => {
    const body = '{"message":{"chat":{"id":"c1"},"text":"hi"}}';
    expect(isDuplicateInbound('demo', body)).toBe(false); // first
    expect(isDuplicateInbound('demo', body)).toBe(true); // replay/retry
    expect(isDuplicateInbound('demo', body)).toBe(true);
  });

  it('does NOT deduplicate distinct payloads or the same body on a different path', () => {
    expect(isDuplicateInbound('demo', '{"id":1}')).toBe(false);
    expect(isDuplicateInbound('demo', '{"id":2}')).toBe(false); // distinct body
    expect(isDuplicateInbound('other', '{"id":1}')).toBe(false); // same body, different path
  });

  it('never treats an empty body as a duplicate', () => {
    expect(isDuplicateInbound('demo', '')).toBe(false);
    expect(isDuplicateInbound('demo', '')).toBe(false);
  });
});
