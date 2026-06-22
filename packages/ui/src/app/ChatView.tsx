import React from 'react';
import { useStore } from '../store/store.js';
import type { ConvoBlock } from '../store/model.js';
import { Message, AssistantTurn } from './Message.js';
import { Composer } from './Composer.js';
import { EmptyState } from './EmptyState.js';
import { useTheme } from '../theme/theme.js';
import { TraceLoader } from './replay.js';
import { cn } from '../lib/cn.js';

function ConnectionDot() {
  const c = useStore(s => s.connection);
  const mode = useStore(s => s.mode);
  const color =
    mode === 'replay'
      ? 'text-agent'
      : c === 'open'
      ? 'text-knowledge'
      : c === 'connecting'
      ? 'text-brand-2'
      : 'text-destructive';
  const dot = mode === 'replay' ? '⏵' : c === 'open' ? '●' : c === 'connecting' ? '◌' : '○';
  const label = mode === 'replay' ? 'replay' : c;
  return (
    <span className={`flex items-center gap-1 text-xs ${color}`}>
      <span>{dot}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

type MessageGroup =
  | { type: 'user'; block: ConvoBlock }
  | { type: 'assistant'; blocks: ConvoBlock[]; nodeIds: string[] };

function groupBlocks(blocks: ConvoBlock[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let current: ConvoBlock[] = [];
  let nodeIds: string[] = [];

  const flush = () => {
    if (current.length) {
      groups.push({ type: 'assistant', blocks: current, nodeIds });
      current = [];
      nodeIds = [];
    }
  };

  for (const b of blocks) {
    if (b.type === 'user') {
      flush();
      groups.push({ type: 'user', block: b });
    } else {
      current.push(b);
      if (b.nodeId && !nodeIds.includes(b.nodeId)) nodeIds.push(b.nodeId);
    }
  }
  flush();
  return groups;
}

interface ChatViewProps {
  onOpenDevPanel?: () => void;
  devPanelOpen?: boolean;
  projectId?: string | null;
  singleSession?: boolean;
  className?: string;
}

export function ChatView({
  onOpenDevPanel,
  devPanelOpen,
  projectId,
  singleSession,
  className,
}: ChatViewProps) {
  const spaceName = useStore(s => s.spaceName);
  const agentSlug = useStore(s => s.agentSlug);
  const projects = useStore(s => s.projects);
  const activeProjectId = useStore(s => s.activeProjectId);
  const model = useStore(s => s.model);
  const follow = useStore(s => s.follow);
  const setFollow = useStore(s => s.setFollow);
  const noteUser = useStore(s => s.noteUserMessage);
  const mode = useStore(s => s.mode);
  const [theme, , toggleTheme] = useTheme();
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = React.useState(true);

  const blocks = model?.blocks ?? [];
  const groups = groupBlocks(blocks);

  // Auto-scroll to bottom when following
  React.useEffect(() => {
    if (follow && atBottom) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [blocks.length, follow, atBottom]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 60);
  };

  const handleSend = (text: string) => {
    noteUser(text);
    const send = (window as unknown as { __LM_SEND__?: (m: unknown) => void }).__LM_SEND__;
    send?.({ type: 'sendMessage', content: text });
  };

  const handleSuggestion = (text: string) => handleSend(text);

  // Friendly title — never the raw filesystem path.
  const prettyAgent = agentSlug
    ? agentSlug.toLowerCase() === 'thing'
      ? 'THING'
      : agentSlug.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : '';
  const projectName = projects.find((p) => p.id === activeProjectId)?.name;
  const spaceLabel = singleSession
    ? spaceName.split('/').filter(Boolean).pop() || ''
    : projectName ?? '';
  const title =
    spaceLabel && prettyAgent
      ? `${spaceLabel} · ${prettyAgent}`
      : spaceLabel || prettyAgent || 'THING';

  return (
    <div className={cn('flex flex-col h-full bg-background', className)}>
      {/* Header */}
      <header
        className="flex items-center gap-3 pl-12 md:pl-4 pr-4 py-2.5 border-b border-border bg-background/80 backdrop-blur-sm shrink-0"
        aria-label="chat header"
      >
        <span className="text-sm font-medium text-foreground truncate flex-1">{title}</span>
        <div className="flex items-center gap-2 shrink-0">
          {mode === 'live' && (
            <button
              onClick={() => setFollow(!follow)}
              data-testid="follow-toggle"
              className={`text-xs ${follow ? 'text-agent' : 'text-muted-foreground hover:text-foreground'}`}
              title="Follow mode"
            >
              {follow ? '⊙' : '○'}
            </button>
          )}
          <ConnectionDot />
          <TraceLoader />
          <button
            onClick={() => onOpenDevPanel?.()}
            className={cn(
              'text-xs px-2 py-1 rounded-lg transition-colors',
              devPanelOpen
                ? 'bg-agent/15 text-agent'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted',
            )}
            title="Toggle DevPanel (⌥I)"
          >
            Inspect
          </button>
          <button
            onClick={toggleTheme}
            data-testid="theme-toggle"
            className="text-xs text-muted-foreground hover:text-foreground"
            title="Toggle theme"
          >
            {theme === 'light' ? '☾' : '☀'}
          </button>
        </div>
      </header>

      {/* Messages */}
      <main
        ref={scrollRef}
        className="flex-1 overflow-y-auto"
        onScroll={handleScroll}
        aria-label="conversation"
        aria-live="polite"
        aria-atomic="false"
      >
        <div className="max-w-3xl mx-auto py-6 min-h-full flex flex-col">
          {groups.length === 0 ? (
            <EmptyState
              projectName={!singleSession && spaceLabel ? spaceLabel : undefined}
              onSuggestion={mode !== 'replay' ? handleSuggestion : undefined}
            />
          ) : (
            groups.map((g, i) =>
              g.type === 'user' ? (
                <Message key={i} block={g.block} />
              ) : (
                <AssistantTurn key={i} blocks={g.blocks} nodeIds={g.nodeIds} />
              ),
            )
          )}
          <div ref={bottomRef} />
        </div>
      </main>

      {/* Scroll to bottom button */}
      {!atBottom && (
        <button
          onClick={() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' })}
          className="absolute bottom-24 right-6 w-8 h-8 rounded-full bg-card border border-border shadow-md flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors z-10"
          aria-label="Scroll to bottom"
        >
          ↓
        </button>
      )}

      {/* Composer */}
      <Composer onSend={handleSend} projectId={projectId} />
    </div>
  );
}
