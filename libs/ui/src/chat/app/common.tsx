import * as Prim from '../../elements/primitives/index';
import React from 'react';
import type { NodeStatus, NodeKind } from '../store/model';

export const STATUS_GLYPH: Record<NodeStatus, string> = {
  queued: '○',
  running: '⟳',
  done: '✓',
  error: '✗',
  skipped: '⊘',
};

// Colour tables hold the VALUE, not a className — a lookup of class strings is still a className
// at the call site. These used to read `var(--lm-…)`, a bridge `app/styles.css:42-55` aliases onto
// these same tokens for the web `/chat` route only. React Native never loads that stylesheet — its
// primitive layer rewrites ANY `var(--x)` straight to the (nonexistent) Tamagui token `$x`, with no
// knowledge of the bridge — so every status/kind colour in the execution tree and inspector
// silently vanished on a phone. Spelled as the real, always-registered token directly instead.
const STATUS_COLOR: Record<NodeStatus, string> = {
  queued: 'var(--muted-foreground)',
  running: 'var(--agent)',
  done: 'var(--success)',
  error: 'var(--destructive)',
  skipped: 'var(--muted-foreground)',
};

const KIND_COLOR: Record<NodeKind, string> = {
  session: 'var(--foreground)',
  run: 'var(--muted-foreground)',
  fork: 'var(--knowledge)',
  delegate: 'var(--agent)',
  tasklist: 'var(--warning)',
  task: 'var(--warning)',
};

export function StatusIcon({ status }: { status: NodeStatus }): React.ReactElement {
  const glyph = STATUS_GLYPH[status];
  return (
    // `lm-spin` is a KEYFRAME animation, which the CSS driver does not cover — the driver's job
    // is transitions. It stays a hand-written class in `chat/app/styles.css` (§5).
    <Prim.Text
      color={STATUS_COLOR[status]}
      className={status === 'running' ? 'lm-spin' : undefined}
      aria-label={status}
      data-status={status}
    >
      {glyph}
    </Prim.Text>
  );
}

export function KindBadge({ kind }: { kind: NodeKind }): React.ReactElement {
  return (
    <Prim.Text
      color={KIND_COLOR[kind]}
      fontFamily="$mono"
      fontSize="10px"
      textTransform="uppercase"
      letterSpacing="$wide"
    >{kind}</Prim.Text>
  );
}

export function Badge({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'amber' | 'red' }): React.ReactElement {
  const TONE = {
    amber: { color: 'var(--warning)', borderColor: 'color-mix(in srgb, var(--warning) 40%, transparent)' },
    red: { color: 'var(--destructive)', borderColor: 'color-mix(in srgb, var(--destructive) 40%, transparent)' },
    muted: { color: 'var(--muted-foreground)', borderColor: 'var(--border)' },
  } as const;
  return (
    <Prim.Text
      display="inline-flex"
      alignItems="center"
      borderRadius="$radius"
      paddingHorizontal="$1.5"
      paddingVertical="$0.5"
      fontSize="10px"
      fontFamily="$mono"
      borderWidth={1}
      {...TONE[tone]}
    >
      {children}
    </Prim.Text>
  );
}

export function fmtDuration(ms?: number): string {
  if (ms === undefined) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function CodeBlock({ code }: { code: string }): React.ReactElement {
  return (
    // `Prim.Pre` is Tamagui-backed now, so all of this is style PROPS — it used to be an inline
    // `style` object because a host passthrough ignores them. See docs/tamagui-idiomatic-migration.md §5.
    <Prim.Pre
      fontFamily="$mono"
      fontSize="11px"
      lineHeight={18}
      whiteSpace="pre-wrap"
      wordWrap="break-word"
      backgroundColor="var(--background)"
      borderWidth={1}
      borderColor="var(--border)"
      borderRadius="$radius"
      padding="$2"
      overflowX="auto"
      color="var(--foreground)"
    >
      {code}
    </Prim.Pre>
  );
}

export function Tabs<T extends string>({ tabs, active, onChange }: { tabs: readonly T[]; active: T; onChange: (t: T) => void }): React.ReactElement {
  return (
    <Prim.Row borderColor="var(--border)" gap="$1" borderBottomWidth={1} role="tablist">
      {tabs.map((t) => (
        <Prim.Pressable
          key={t}
          role="tab"
          aria-selected={active === t}
          data-testid={`inspector-tab-${t}`}
          onClick={() => onChange(t)}
          transition="quick" animateOnly={["color", "background-color", "border-color"]}
          paddingHorizontal="$3"
          paddingVertical="$1.5"
          fontSize="11px"
          fontFamily="$mono"
          textTransform="capitalize"
          borderBottomWidth={2}
          marginBottom={-1}
          {...(active === t
            ? { borderBottomColor: 'var(--agent)', color: 'var(--foreground)' }
            : { borderBottomColor: 'transparent', color: 'var(--muted-foreground)', hoverStyle: { color: 'var(--foreground)' } })}
        >
          {t}
        </Prim.Pressable>
      ))}
    </Prim.Row>
  );
}

export function preview(v: unknown, max = 200): string {
  let s: string;
  try { s = typeof v === 'string' ? v : JSON.stringify(v); } catch { s = String(v); }
  if (s === undefined) s = String(v);
  return s.length > max ? s.slice(0, max) + `… (${s.length})` : s;
}
