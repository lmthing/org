import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { signHmac } from './webhook-sign.mjs';

describe('signHmac', () => {
  it('matches a manually computed hex HMAC-SHA256 with the demo prefix scheme', () => {
    const body = JSON.stringify({ message: { text: 'hi' } });
    const expected = 'sha256=' + createHmac('sha256', 'whsec-xyz-789').update(body, 'utf8').digest('hex');
    expect(signHmac('whsec-xyz-789', body, { algo: 'sha256', encoding: 'hex', prefix: 'sha256=' })).toBe(expected);
  });

  it('defaults to sha256/hex/no-prefix when the spec is omitted', () => {
    const out = signHmac('secret', 'body');
    expect(out).toBe(createHmac('sha256', 'secret').update('body', 'utf8').digest('hex'));
  });

  it('a wrong secret produces a DIFFERENT signature — proof this is a real HMAC, not an echo', () => {
    const a = signHmac('secret-a', 'same body');
    const b = signHmac('secret-b', 'same body');
    expect(a).not.toBe(b);
  });
});
