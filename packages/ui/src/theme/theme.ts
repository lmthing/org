/**
 * Web theme control. Themes are CSS-variable sets keyed by `data-theme` on
 * <html> (see styles.css). `applyTheme` flips the attribute and persists the
 * choice; `useTheme` is a tiny React hook for a theme switcher. Spaces may also
 * inject a custom token block via `applyThemeTokens` (driven by a space's
 * optional `theme.json`).
 */
import React from 'react';

export type ThemeName = 'dark' | 'light' | (string & {});

const STORAGE_KEY = 'lm-theme';

export function currentTheme(): ThemeName {
  if (typeof document === 'undefined') return 'dark';
  return (document.documentElement.getAttribute('data-theme') as ThemeName) ?? 'dark';
}

export function applyTheme(theme: ThemeName): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* private mode / SSR — ignore */
  }
}

export function initTheme(fallback: ThemeName = 'dark'): ThemeName {
  let theme = fallback;
  try {
    theme = (localStorage.getItem(STORAGE_KEY) as ThemeName) ?? fallback;
  } catch {
    /* ignore */
  }
  applyTheme(theme);
  return theme;
}

/** Override individual `--lm-*` tokens at runtime (e.g. from a space theme.json). */
export function applyThemeTokens(tokens: Record<string, string>): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const [k, v] of Object.entries(tokens)) {
    const name = k.startsWith('--') ? k : `--lm-${k}`;
    root.style.setProperty(name, v);
    root.style.setProperty(name.replace('--lm-', '--color-lm-'), v);
  }
}

export function useTheme(): [ThemeName, (t: ThemeName) => void, () => void] {
  const [theme, setThemeState] = React.useState<ThemeName>(() => currentTheme());
  const setTheme = React.useCallback((t: ThemeName) => {
    applyTheme(t);
    setThemeState(t);
  }, []);
  const toggle = React.useCallback(() => {
    setTheme(currentTheme() === 'light' ? 'dark' : 'light');
  }, [setTheme]);
  return [theme, setTheme, toggle];
}
