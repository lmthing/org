import { describe, it, expect } from 'vitest'

import { resolveFocusTeamId } from './focus'

const TEAMS = [{ id: 'a' }, { id: 'b' }]

describe('resolveFocusTeamId', () => {
  it('switches to the requested team when the member is on it', () => {
    expect(resolveFocusTeamId(TEAMS, 'b', 'a')).toBe('b')
  })

  it('keeps the current team when no team was requested', () => {
    expect(resolveFocusTeamId(TEAMS, null, 'a')).toBe('a')
    expect(resolveFocusTeamId(TEAMS, undefined, 'a')).toBe('a')
  })

  it('keeps the current team when the request names one the member is NOT on — an expired invite must not swap the screen onto a stranger’s team', () => {
    expect(resolveFocusTeamId(TEAMS, 'ghost', 'a')).toBe('a')
  })

  it('keeps the current selection while the list has not loaded yet, rather than guessing', () => {
    expect(resolveFocusTeamId(null, 'a', null)).toBeNull()
  })
})
