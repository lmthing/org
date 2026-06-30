import { describe, it, expect } from 'vitest';
import { parseDelegateRef } from './ref.js';

describe('parseDelegateRef — six grammar forms', () => {
  it('"agent" -> self, all actions', () => {
    expect(parseDelegateRef('pairing')).toEqual({ scope: 'self', agent: 'pairing', action: undefined });
  });

  it('"agent#action" -> self, single action', () => {
    expect(parseDelegateRef('pairing#suggest')).toEqual({
      scope: 'self',
      agent: 'pairing',
      action: 'suggest',
    });
  });

  it('"space/agent" -> project, all actions', () => {
    expect(parseDelegateRef('sommelier/pairing')).toEqual({
      scope: 'project',
      space: 'sommelier',
      agent: 'pairing',
      action: undefined,
    });
  });

  it('"space/agent#action" -> project, single action', () => {
    expect(parseDelegateRef('sommelier/pairing#suggest')).toEqual({
      scope: 'project',
      space: 'sommelier',
      agent: 'pairing',
      action: 'suggest',
    });
  });

  it('"npm:pkg/agent" -> npm, all actions', () => {
    expect(parseDelegateRef('npm:@my-org/space/chef')).toEqual({
      scope: 'npm',
      space: '@my-org/space',
      agent: 'chef',
      action: undefined,
    });
  });

  it('"npm:pkg/agent#action" -> npm, single action', () => {
    expect(parseDelegateRef('npm:@my-org/space/chef#prep')).toEqual({
      scope: 'npm',
      space: '@my-org/space',
      agent: 'chef',
      action: 'prep',
    });
  });

  it('throws on "npm:" with no agent path', () => {
    expect(() => parseDelegateRef('npm:justapkg')).toThrow(/npm:/);
  });
});
