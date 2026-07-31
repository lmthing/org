import { describe, it, expect } from 'vitest';
import { intersectAppCaps } from './capability.js';
import type { AppCapabilities } from '../spaces/capabilities.js';

/**
 * A team `viewer` may talk to the agent and may not change the workspace.
 *
 * That rule lived only in prose: the caller's role reaches the turn as DATA
 * (`teamContext().caller.role`), the agent held `db:write` regardless, and a
 * viewer's request was refused only if the agent chose to refuse it. In a live
 * run one was not — the turn read the role, ignored it, ran `display(db.tables())`
 * and settled `done`, and the person was told nothing at all.
 *
 * `SessionOpts.readOnly` withholds the grants instead, reusing the read-only fork
 * gate rather than inventing a second one. Not granted means not injected AND
 * absent from the DTS, so a write becomes a typecheck error the model sees.
 */
describe('a read-only caller cannot be granted the writers', () => {
  const full: AppCapabilities = {
    'db:read': {}, 'db:write': {}, 'db:schema': {},
    'pages:write': true, 'views:write': true, 'api:write': true, 'hooks:write': true,
    'knowledge:write': {}, 'store:read': true, 'store:install': true, 'events:emit': true,
    'team:read': true, 'team:post': true, 'api:call': { allow: ['x'] },
  } as AppCapabilities;

  it('drops every write grant, including the team writer', () => {
    const ro = intersectAppCaps(full, false);
    for (const denied of ['db:write','db:schema','pages:write','views:write','api:write','hooks:write','knowledge:write','store:install','events:emit','team:post']) {
      expect(ro[denied as keyof AppCapabilities], `${denied} must not survive`).toBeUndefined();
    }
  });

  it('keeps what reading requires, so the turn can still answer', () => {
    const ro = intersectAppCaps(full, false);
    // A viewer must still be able to look things up and say something back —
    // withholding these would make the session useless rather than safe.
    for (const kept of ['db:read','api:call','store:read','team:read']) {
      expect(ro[kept as keyof AppCapabilities], `${kept} must survive`).toBeDefined();
    }
  });

  it('is a no-op for an editor', () => {
    expect(intersectAppCaps(full, true)).toBe(full);
  });
});
