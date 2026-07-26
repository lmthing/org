// ds-lint-file-ok: terminal ANSI color palette (Ink color names → --lm-* terminal theme vars), not brand UI
/**
 * Ink compatibility layer for the web.
 *
 * Web React implementations that mirror the public API of `ink`,
 * `ink-text-input`, and `ink-select-input` so a component authored against Ink
 * renders unchanged in the browser. Ink color names resolve to theme CSS vars
 * (`--lm-*`), so everything here is themeable for free.
 *
 * `serve.ts` aliases `ink` / `ink-text-input` / `ink-select-input` to this
 * module, and `@lmthing/agent-ui/compat` re-exports it for direct authoring.
 */
import * as Prim from '../../elements/primitives/index';
import React from 'react';
import { onKeyDown } from '../../platform/keyboard';

// ─── color + dimension helpers ───────────────────────────────────────────────

/** Ink color name → CSS color (theme var when we have one, else the literal). */
export function inkColor(name: unknown): string | undefined {
  if (typeof name !== 'string') return undefined;
  if (name.startsWith('#') || name.startsWith('rgb') || name.startsWith('hsl')) return name;
  const themed: Record<string, string> = {
    cyan: 'var(--lm-cyan, #39c5cf)',
    cyanBright: 'var(--lm-cyan, #56d4dd)',
    blue: 'var(--lm-accent, #58a6ff)',
    blueBright: 'var(--lm-accent, #79c0ff)',
    green: 'var(--lm-green, #3fb950)',
    greenBright: 'var(--lm-green, #56d364)',
    red: 'var(--lm-red, #f85149)',
    redBright: 'var(--lm-red, #ff7b72)',
    yellow: 'var(--lm-amber, #d29922)',
    yellowBright: 'var(--lm-amber, #e3b341)',
    magenta: 'var(--lm-purple, #bc8cff)',
    magentaBright: 'var(--lm-purple, #d2a8ff)',
    gray: 'var(--lm-muted, #8b949e)',
    grey: 'var(--lm-muted, #8b949e)',
    white: 'var(--lm-text, #e6edf3)',
    whiteBright: '#ffffff',
    black: '#010409',
  };
  return themed[name] ?? name;
}

function dim(v: unknown): string | number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'number') return v; // Ink "cells"; treated as px on web
  if (typeof v === 'string') return v; // e.g. "100%"
  return undefined;
}

const BORDER_STYLE: Record<string, string> = {
  single: 'solid',
  double: 'double',
  round: 'solid',
  bold: 'solid',
  singleDouble: 'solid',
  doubleSingle: 'solid',
  classic: 'solid',
  arrow: 'solid',
};

// ─── Box ──────────────────────────────────────────────────────────────────────

export interface BoxProps {
  children?: React.ReactNode;
  flexDirection?: 'row' | 'column' | 'row-reverse' | 'column-reverse';
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: number | string;
  flexWrap?: 'nowrap' | 'wrap' | 'wrap-reverse';
  alignItems?: 'flex-start' | 'center' | 'flex-end' | 'stretch';
  alignSelf?: 'flex-start' | 'center' | 'flex-end' | 'auto';
  justifyContent?:
    | 'flex-start'
    | 'center'
    | 'flex-end'
    | 'space-between'
    | 'space-around';
  gap?: number;
  columnGap?: number;
  rowGap?: number;
  width?: number | string;
  height?: number | string;
  minWidth?: number | string;
  minHeight?: number | string;
  padding?: number;
  paddingX?: number;
  paddingY?: number;
  paddingTop?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  paddingRight?: number;
  margin?: number;
  marginX?: number;
  marginY?: number;
  marginTop?: number;
  marginBottom?: number;
  marginLeft?: number;
  marginRight?: number;
  borderStyle?: keyof typeof BORDER_STYLE;
  borderColor?: string;
  display?: 'flex' | 'none';
  style?: React.CSSProperties;
}

export function Box(props: BoxProps): React.ReactElement {
  const s: React.CSSProperties = {
    display: props.display === 'none' ? 'none' : 'flex',
    flexDirection: props.flexDirection ?? 'row',
    flexGrow: props.flexGrow,
    flexShrink: props.flexShrink,
    flexBasis: props.flexBasis,
    flexWrap: props.flexWrap,
    alignItems: props.alignItems,
    alignSelf: props.alignSelf,
    justifyContent: props.justifyContent,
    gap: props.gap !== undefined ? props.gap * 4 : undefined,
    columnGap: props.columnGap !== undefined ? props.columnGap * 4 : undefined,
    rowGap: props.rowGap !== undefined ? props.rowGap * 4 : undefined,
    width: dim(props.width),
    height: dim(props.height),
    minWidth: dim(props.minWidth),
    minHeight: dim(props.minHeight),
    padding: cell(props.padding),
    paddingTop: cell(props.paddingTop ?? props.paddingY),
    paddingBottom: cell(props.paddingBottom ?? props.paddingY),
    paddingLeft: cell(props.paddingLeft ?? props.paddingX),
    paddingRight: cell(props.paddingRight ?? props.paddingX),
    margin: cell(props.margin),
    marginTop: cell(props.marginTop ?? props.marginY),
    marginBottom: cell(props.marginBottom ?? props.marginY),
    marginLeft: cell(props.marginLeft ?? props.marginX),
    marginRight: cell(props.marginRight ?? props.marginX),
    ...(props.borderStyle
      ? {
          borderStyle: BORDER_STYLE[props.borderStyle] ?? 'solid',
          borderWidth: 1,
          borderColor: inkColor(props.borderColor) ?? 'var(--lm-border, #30363d)',
          borderRadius: props.borderStyle === 'round' ? 6 : 0,
        }
      : {}),
    ...props.style,
  };
  return <Prim.Box style={s}>{props.children}</Prim.Box>;
}

function cell(v: number | undefined): number | undefined {
  return v === undefined ? undefined : v * 4;
}

// ─── Text ───────────────────────────────────────────────────────────────────--

export interface TextProps {
  children?: React.ReactNode;
  color?: string;
  backgroundColor?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  dimColor?: boolean;
  inverse?: boolean;
  wrap?: 'wrap' | 'truncate' | 'truncate-start' | 'truncate-middle' | 'truncate-end';
  style?: React.CSSProperties;
}

export function Text(props: TextProps): React.ReactElement {
  const truncate = typeof props.wrap === 'string' && props.wrap.startsWith('truncate');
  const fg = inkColor(props.color);
  const bg = inkColor(props.backgroundColor);
  const s: React.CSSProperties = {
    color: props.inverse ? (bg ?? 'var(--lm-bg)') : fg,
    backgroundColor: props.inverse ? (fg ?? 'var(--lm-text)') : bg,
    fontWeight: props.bold ? 600 : undefined,
    fontStyle: props.italic ? 'italic' : undefined,
    textDecoration:
      [props.underline && 'underline', props.strikethrough && 'line-through']
        .filter(Boolean)
        .join(' ') || undefined,
    opacity: props.dimColor ? 0.6 : undefined,
    whiteSpace: props.wrap === 'wrap' ? 'pre-wrap' : truncate ? 'nowrap' : undefined,
    overflow: truncate ? 'hidden' : undefined,
    textOverflow: truncate ? 'ellipsis' : undefined,
    ...props.style,
  };
  return <Prim.Text style={s}>{props.children}</Prim.Text>;
}

// ─── layout helpers ───────────────────────────────────────────────────────────

export function Spacer(): React.ReactElement {
  return <Prim.Box flexGrow={1} />;
}

export function Newline({ count = 1 }: { count?: number }): React.ReactElement {
  return <>{Array.from({ length: count }, (_, i) => <Prim.Br key={i} />)}</>;
}

/** Ink renders <Static> output once above the live frame; on web it's a plain block. */
export function Static<T>({
  items,
  children,
}: {
  items: T[];
  children: (item: T, index: number) => React.ReactNode;
}): React.ReactElement {
  return <>{items.map((it, i) => <React.Fragment key={i}>{children(it, i)}</React.Fragment>)}</>;
}

export function Transform({
  transform,
  children,
}: {
  transform: (s: string) => string;
  children: React.ReactNode;
}): React.ReactElement {
  return <Prim.Text>{typeof children === 'string' ? transform(children) : children}</Prim.Text>;
}

// ─── hooks (browser-safe shims) ───────────────────────────────────────────────

export interface Key {
  upArrow: boolean;
  downArrow: boolean;
  leftArrow: boolean;
  rightArrow: boolean;
  return: boolean;
  escape: boolean;
  tab: boolean;
  backspace: boolean;
  delete: boolean;
  ctrl: boolean;
  shift: boolean;
  meta: boolean;
  pageUp: boolean;
  pageDown: boolean;
}

const EMPTY_KEY: Key = {
  upArrow: false, downArrow: false, leftArrow: false, rightArrow: false,
  return: false, escape: false, tab: false, backspace: false, delete: false,
  ctrl: false, shift: false, meta: false, pageUp: false, pageDown: false,
};

/** Mirrors Ink's useInput: invokes handler on keydown with (input, key). */
export function useInput(
  handler: (input: string, key: Key) => void,
  opts?: { isActive?: boolean },
): void {
  const ref = React.useRef(handler);
  ref.current = handler;
  React.useEffect(() => {
    if (opts && opts.isActive === false) return;
    const onKey = (e: KeyboardEvent) => {
      const named: Record<string, Partial<Key>> = {
        ArrowUp: { upArrow: true }, ArrowDown: { downArrow: true },
        ArrowLeft: { leftArrow: true }, ArrowRight: { rightArrow: true },
        Enter: { return: true }, Escape: { escape: true }, Tab: { tab: true },
        Backspace: { backspace: true }, Delete: { delete: true },
        PageUp: { pageUp: true }, PageDown: { pageDown: true },
      };
      const k: Key = { ...EMPTY_KEY, ctrl: e.ctrlKey, shift: e.shiftKey, meta: e.metaKey, ...(named[e.key] ?? {}) };
      const input = e.key.length === 1 ? e.key : '';
      ref.current(input, k);
    };
    return onKeyDown(onKey);
  }, [opts?.isActive]);
}

export function useFocus(_opts?: { autoFocus?: boolean; id?: string }): { isFocused: boolean } {
  return { isFocused: true };
}
export function useFocusManager() {
  return { enableFocus() {}, disableFocus() {}, focusNext() {}, focusPrevious() {}, focus(_id: string) {} };
}
export function useApp() {
  return { exit: (_error?: Error) => {} };
}
export function useStdin() {
  return { stdin: undefined, isRawModeSupported: false, setRawMode() {} };
}
export function useStdout() {
  return { stdout: undefined, write(_s: string) {} };
}
export function useStderr() {
  return { stderr: undefined, write(_s: string) {} };
}

// `render` is meaningless on web (the host mounts the tree); provide a no-op so
// modules that call it at import time don't crash.
export function render(_node: React.ReactNode) {
  return { unmount() {}, rerender(_n: React.ReactNode) {}, clear() {}, waitUntilExit: async () => {} };
}

export default { Box, Text, Spacer, Newline, Static, Transform, render };
