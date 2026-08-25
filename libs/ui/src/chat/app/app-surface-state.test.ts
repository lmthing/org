import { describe, it, expect } from 'vitest';
import { deriveAppSurfaceState } from './use-app-pages';

/**
 * The chat-first shell's keystone primitive: a project is `newborn` (the whole surface IS the chat)
 * while its only openable page is the home, and becomes `app` (nav rail appears, chat demotes to the
 * floating dock) the moment a real page beyond the home exists.
 */
describe('deriveAppSurfaceState', () => {
  it('is newborn when there are no pages at all', () => {
    expect(deriveAppSurfaceState([])).toBe('newborn');
  });

  it('is newborn when the only page is the home (chat placeholder)', () => {
    expect(deriveAppSurfaceState(['/'])).toBe('newborn');
    expect(deriveAppSurfaceState(['/index'])).toBe('newborn');
    expect(deriveAppSurfaceState([''])).toBe('newborn');
  });

  it('becomes app the moment a real page beyond the home exists', () => {
    expect(deriveAppSurfaceState(['/', '/expenses'])).toBe('app');
    expect(deriveAppSurfaceState(['/dashboard'])).toBe('app');
    expect(deriveAppSurfaceState(['/', '/trips', '/recipes'])).toBe('app');
  });
});
