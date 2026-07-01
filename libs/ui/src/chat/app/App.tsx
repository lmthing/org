import React from 'react';
import { useStore } from '../store/store.js';
import { ExecutionTree } from './tree.js';
import { ConversationStream } from './conversation.js';
import { Inspector } from './inspector.js';
import { TraceLoader, PlaybackBar } from './replay.js';
import { useTheme } from '../../theme/theme.js';

function ThemeToggle(): React.ReactElement {
  const [theme, , toggle] = useTheme();
  return (
    <button onClick={toggle} className="text-[11px] text-lm-muted hover:text-lm-text" data-testid="theme-toggle" title="Toggle light / dark">
      {theme === 'light' ? '☀ light' : '☾ dark'}
    </button>
  );
}

function ConnectionDot(): React.ReactElement {
  const c = useStore((s) => s.connection);
  const mode = useStore((s) => s.mode);
  const color = mode === 'replay' ? 'var(--agent)' : c === 'open' ? 'var(--success)' : c === 'connecting' ? 'var(--warning)' : 'var(--destructive)';
  const label = mode === 'replay' ? 'replay' : c;
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-lm-muted">
      <span style={{ width: 8, height: 8, borderRadius: 8, background: color, display: 'inline-block' }} />
      {label}
    </span>
  );
}

function RestartButton(): React.ReactElement | null {
  const mode = useStore((s) => s.mode);
  const [restarting, setRestarting] = React.useState(false);
  if (mode !== 'live') return null;
  const handleRestart = async () => {
    setRestarting(true);
    try { await fetch('/api/restart', { method: 'POST' }); } catch { /* expected */ }
    const poll = async () => {
      try { const r = await fetch('/api/env'); if (r.ok) { window.location.reload(); return; } } catch { /* still down */ }
      setTimeout(poll, 800);
    };
    setTimeout(poll, 1000);
  };
  return (
    <button
      onClick={() => { void handleRestart(); }}
      disabled={restarting}
      className="text-[11px] text-lm-muted hover:text-lm-text disabled:opacity-40"
      title="Restart CLI process (reloads .env)"
    >
      {restarting ? '↻' : '⏻'}
    </button>
  );
}

function TopBar(): React.ReactElement {
  const spaceName = useStore((s) => s.spaceName);
  const agentSlug = useStore((s) => s.agentSlug);
  const follow = useStore((s) => s.follow);
  const setFollow = useStore((s) => s.setFollow);
  const mode = useStore((s) => s.mode);
  return (
    <header className="flex items-center gap-3 px-3 py-2 border-b border-lm-border bg-lm-panel shrink-0">
      <span className="font-semibold text-lm-text text-[13px]">LMThing</span>
      <span className="text-[11px] text-lm-muted font-mono truncate max-w-[40%]" title={spaceName}>{spaceName || '—'}{agentSlug ? ` · ${agentSlug}` : ''}</span>
      <div className="ml-auto flex items-center gap-3">
        {mode === 'live' && (
          <button
            onClick={() => setFollow(!follow)}
            className={`text-[11px] ${follow ? 'text-lm-accent' : 'text-lm-muted'}`}
            data-testid="follow-toggle"
          >
            {follow ? '⊙ following' : '○ follow'}
          </button>
        )}
        <ThemeToggle />
        <RestartButton />
        <TraceLoader />
        <ConnectionDot />
      </div>
    </header>
  );
}

/** A draggable vertical divider between panes. */
function Resizer({ onDrag }: { onDrag: (dx: number) => void }): React.ReactElement {
  const down = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const move = (ev: MouseEvent) => onDrag(ev.clientX - startX);
    let last = startX;
    const movewrap = (ev: MouseEvent) => { onDrag(ev.clientX - last); last = ev.clientX; };
    void move;
    const up = () => { window.removeEventListener('mousemove', movewrap); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', movewrap);
    window.addEventListener('mouseup', up);
  };
  return <div onMouseDown={down} className="w-1 cursor-col-resize bg-lm-border hover:bg-lm-accent/50 shrink-0" />;
}

export function App(): React.ReactElement {
  const mode = useStore((s) => s.mode);
  const [leftW, setLeftW] = React.useState(300);
  const [rightW, setRightW] = React.useState(380);

  // Reflect live status in the document title (readable from the tab list).
  const running = useStore((s) => Object.values(s.model.nodes).filter((n) => n.status === 'running').length);
  const done = useStore((s) => s.done);
  React.useEffect(() => {
    document.title = mode === 'replay' ? '⏵ replay · lmthing' : running > 0 ? `⟳ ${running} running · lmthing` : done ? '✓ done · lmthing' : 'lmthing';
  }, [running, done, mode]);

  return (
    <div className="h-full flex flex-col">
      <TopBar />
      <div className="flex-1 flex min-h-0">
        <div style={{ width: leftW }} className="shrink-0 border-r border-lm-border bg-lm-panel overflow-hidden">
          <ExecutionTree />
        </div>
        <Resizer onDrag={(dx) => setLeftW((w) => Math.max(180, Math.min(600, w + dx)))} />
        <div className="flex-1 min-w-0 flex flex-col">
          <ConversationStream />
          {mode === 'replay' && <PlaybackBar />}
        </div>
        <Resizer onDrag={(dx) => setRightW((w) => Math.max(240, Math.min(700, w - dx)))} />
        <div style={{ width: rightW }} className="shrink-0 border-l border-lm-border bg-lm-panel overflow-hidden">
          <Inspector />
        </div>
      </div>
    </div>
  );
}
