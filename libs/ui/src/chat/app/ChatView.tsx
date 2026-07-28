import * as Prim from '../../elements/primitives/index';
import React from 'react';
import { useStore } from '../store/store';
import type { ConvoBlock, UploadedAttachment } from '../store/model';
import { Message, AssistantTurn } from './Message';
import { Composer } from './Composer';
import { LiveActivity } from './LiveActivity';
import { EmptyState } from './EmptyState';
import { useTheme } from '../../theme/theme';
import { TraceLoader } from './replay';
import { cn } from '../lib/cn';
import { BugReportDialog } from './BugReportDialog';
import { authHeaders } from './auth';
import { apiUrl } from '../../platform/api-base';
import { getLiveSend } from './live-send';
import { reloadApp } from '../../platform/navigation';

function formatCost(usd: number): string {
  if (usd < 0.000001) return '';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

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
    <Prim.Text display="flex" alignItems="center" gap="$1" fontSize="$xs" color={color}>
      <Prim.Text>{dot}</Prim.Text>
      <Prim.Text color="$muted-foreground">{label}</Prim.Text>
    </Prim.Text>
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
  /** Flex-child sizing. Replaces `className="flex-1 min-h-0"` at the AppShell call site. */
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: number | string;
  minHeight?: number | string;
}

/** `bg-agent/15 text-agent` / `text-muted-foreground hover:text-foreground hover:bg-muted`. */
const INSPECT_ON = {
  backgroundColor: 'color-mix(in srgb, var(--agent) 15%, transparent)',
  color: '$agent',
} as const;
const INSPECT_OFF = {
  color: '$muted-foreground',
  hoverStyle: { color: '$foreground', backgroundColor: '$muted' },
} as const;

export function ChatView({
  onOpenDevPanel,
  devPanelOpen,
  projectId,
  singleSession,
  className,
  flexGrow,
  flexShrink,
  flexBasis,
  minHeight,
}: ChatViewProps) {
  const spaceName = useStore(s => s.spaceName);
  const agentSlug = useStore(s => s.agentSlug);
  const sessionTitle = useStore(s => s.sessionTitle);
  const activity = useStore(s => s.activity);
  const sessionCostUsd = useStore(s => s.sessionCostUsd + s.sessionCostInflight);
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

  // Auto-scroll to bottom when following.
  //
  // `scrollIntoView` is a DOM method and the ref holds a React Native component instance on native,
  // so the call is OPTIONAL, not merely null-guarded — an unguarded one is a render-time
  // "undefined is not a function" that takes the whole transcript down. Degrading to "no
  // auto-scroll" is deliberate: native has no scrolling host here to drive (the transcript is a
  // `Box`, not a `ScrollView`), and porting that is its own change — see docs/mobile-native-chat.md.
  React.useEffect(() => {
    if (follow && atBottom) {
      bottomRef.current?.scrollIntoView?.({ behavior: 'smooth' });
    }
  }, [blocks.length, follow, atBottom]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    // Same story: these are DOM metrics. Without a scrolling host they are `undefined`, and the
    // arithmetic would silently make `atBottom` false forever and stop follow-mode working.
    if (typeof el?.scrollHeight !== 'number') return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 60);
  };

  const handleSend = (text: string, attachments?: UploadedAttachment[]) => {
    // A budget window is exhausted (0% left) — LiteLLM would 429 the turn anyway.
    if (useStore.getState().budgetBlocked) return;
    noteUser(text, attachments);
    const send = getLiveSend();
    send?.({ type: 'sendMessage', content: text, ...(attachments && attachments.length ? { attachments } : {}) });
  };

  const handleSuggestion = (text: string) => handleSend(text);

  const [bugOpen, setBugOpen] = React.useState(false);
  // No screenshot is captured any more: `modern-screenshot` was the only implementation and it is
  // gone (it walks the DOM, so it could never run on native, and its `await import()` did NOT keep
  // it out of Metro's graph — Metro resolves dynamic imports statically). The dialog already renders
  // "Screenshot unavailable" for null and the gateway treats the field as optional, so the report
  // itself is unaffected. The prop stays so a real capture (Screen Capture API, or
  // react-native-view-shot) is one line to reinstate.
  const openBugReport = () => setBugOpen(true);

  const [restarting, setRestarting] = React.useState(false);
  const handleRestart = async () => {
    setRestarting(true);
    try {
      await fetch(apiUrl('/api/restart'), { method: 'POST', headers: authHeaders() });
    } catch { /* expected — server exits */ }
    // Poll until the server is back up, then reload.
    const poll = async () => {
      try {
        const r = await fetch(apiUrl('/api/env'), { headers: authHeaders() });
        if (r.ok) { setTimeout(reloadApp, 1500); return; }
      } catch { /* still down */ }
      setTimeout(poll, 800);
    };
    setTimeout(poll, 1000);
  };

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
  // Once the agent has named the session (setSessionMeta), show that title;
  // otherwise fall back to the space · agent label.
  const fallbackTitle =
    spaceLabel && prettyAgent
      ? `${spaceLabel} · ${prettyAgent}`
      : spaceLabel || prettyAgent || 'THING';
  const title = sessionTitle || fallbackTitle;

  return (
    <Prim.Box display="flex" className={className} flexDirection="column" height="100%" backgroundColor="$background" {...(flexGrow !== undefined ? { flexGrow } : {})} {...(flexShrink !== undefined ? { flexShrink } : {})} {...(flexBasis !== undefined ? { flexBasis } : {})} {...(minHeight !== undefined ? { minHeight } : {})}>
      {/* Header */}
      <Prim.Box as="header" display="flex" flexDirection="row"
        backdropFilter="blur(8px)" backgroundColor="color-mix(in srgb, var(--background) 80%, transparent)" gap="$3" paddingLeft="$12" paddingRight="$4" paddingVertical="$2.5" borderBottomWidth={1} borderColor="$border" $md={{ paddingLeft: "$4" }} alignItems="center" flexShrink={0}
        aria-label="chat header"
      >
        <Prim.Box flexGrow={1} flexShrink={1} flexBasis="0%" minWidth={0}>
          <Prim.Box fontSize="$sm" fontWeight="$medium" color="$foreground" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap"><Prim.Text>{title}</Prim.Text></Prim.Box>
          {/* THING's live "currently doing" line (setActivity, session scope). Sub-agent
              activities are shown by the LiveActivity/WorkBlock panel, not here. */}
          {activity && (
            <Prim.Row
              marginTop="$0.5" gap="$1.5" fontSize="$xs" color="$muted-foreground" alignItems="center" minWidth={0} lineHeight="1rem"
              aria-live="polite"
              data-testid="activity"
              title={activity}
            >
              <Prim.Text className="animate-pulse" width="$1.5" height="$1.5" borderRadius="$radius-full" backgroundColor="$agent" flexShrink={0} aria-hidden />
              <Prim.Text fontStyle="italic" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">{activity}</Prim.Text>
            </Prim.Row>
          )}
        </Prim.Box>
        {sessionCostUsd > 0 && (
          <Prim.Text fontSize="$xs" color="$muted-foreground" flexShrink={0} title="Session cost">
            {formatCost(sessionCostUsd)}
          </Prim.Text>
        )}
        {/* The workbench controls — everything that is a DEVELOPER affordance rather than part of
            chatting. A phone is 360dp wide: seven of these plus the title do not fit, and the ones
            that fought hardest for the room are the ones a touch user cannot even use (`Load trace`
            opens a file picker; `Restart CLI` restarts a local process). They are hidden below the
            `md` breakpoint — base styles ARE the mobile styles here, `$md` is the desktop override —
            leaving the phone header as hamburger · title · cost · theme. */}
        <Prim.Row gap="$2" alignItems="center" flexShrink={0} display="none" $md={{ display: 'flex' }}>
          {mode === 'live' && (
            <Prim.Pressable
              onClick={() => setFollow(!follow)}
              data-testid="follow-toggle"
              fontSize="$xs"
              {...(follow
                ? { color: '$agent' }
                : { color: '$muted-foreground', hoverStyle: { color: '$foreground' } })}
              title="Follow mode"
            >
              <Prim.Text>{follow ? '⊙' : '○'}</Prim.Text>
            </Prim.Pressable>
          )}
          <ConnectionDot />
          <TraceLoader />
          <Prim.Pressable
            onClick={() => onOpenDevPanel?.()}
            {...(devPanelOpen ? INSPECT_ON : INSPECT_OFF)} transition="quick" animateOnly={["color", "background-color", "border-color"]} fontSize="$xs" paddingHorizontal="$2" paddingVertical="$1" borderRadius="$radius-lg"
            title="Toggle DevPanel (⌥I)"
          >
            <Prim.Text>Inspect</Prim.Text>
          </Prim.Pressable>
          <Prim.Pressable
            onClick={() => { void openBugReport(); }}
            fontSize="$xs" color="$muted-foreground" hoverStyle={{ color: "$foreground" }}
            title="Report a bug"
          >
            <Prim.Text>Report bug</Prim.Text>
          </Prim.Pressable>
          {mode === 'live' && (
            <Prim.Pressable
              onClick={() => { void handleRestart(); }}
              disabled={restarting}
              fontSize="$xs" color="$muted-foreground" hoverStyle={{ color: "$foreground" }} disabledStyle={{ opacity: 0.4 }}
              title="Restart CLI process (reloads .env)"
            >
              <Prim.Text>{restarting ? '↻' : '⏻'}</Prim.Text>
            </Prim.Pressable>
          )}
        </Prim.Row>

        {/* Theme is the one control that survives onto a phone: it is a reader preference rather
            than a workbench tool, and it costs a single glyph of width. */}
        <Prim.Pressable
          onClick={toggleTheme}
          data-testid="theme-toggle"
          fontSize="$xs" color="$muted-foreground" flexShrink={0} hoverStyle={{ color: "$foreground" }}
          title="Toggle theme"
        >
          <Prim.Text>{theme === 'light' ? '☾' : '☀'}</Prim.Text>
        </Prim.Pressable>
      </Prim.Box>

      {/* Messages */}
      <Prim.Box as="main"
        ref={scrollRef}
        flexGrow={1} flexShrink={1} flexBasis="0%" overflowY="auto"
        onScroll={handleScroll}
        aria-label="conversation"
        aria-live="polite"
        aria-atomic="false"
      >
        <Prim.Col maxWidth={768} marginHorizontal="auto" paddingVertical="$6" minHeight="100%">
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
          <Prim.Box ref={bottomRef} />
        </Prim.Col>
      </Prim.Box>

      {/* Ephemeral sub-agent activity (delegates/forks/tasklists). Pinned above
          the composer; renders nothing and takes no space when nothing runs, and
          writes nothing to the transcript. */}
      <LiveActivity />

      {/* Scroll to bottom button */}
      {!atBottom && (
        <Prim.Pressable
          onClick={() => bottomRef.current?.scrollIntoView?.({ behavior: 'smooth' })}
          transition="quick" animateOnly={["color", "background-color", "border-color"]} position="absolute" bottom="$24" right="$6" width="$8" height="$8" borderRadius="$radius-full" backgroundColor="$card" borderWidth={1} borderColor="$border" shadowColor="rgba(0,0,0,0.1)" shadowOffset={{ width: 0, height: 4 }} shadowRadius={6} alignItems="center" justifyContent="center" color="$muted-foreground" zIndex={10} hoverStyle={{ color: "$foreground" }} display="flex"
          aria-label="Scroll to bottom"
        >
          <Prim.Text>↓</Prim.Text>
        </Prim.Pressable>
      )}

      {/* Composer */}
      <Composer onSend={handleSend} projectId={projectId} />

      <BugReportDialog open={bugOpen} onClose={() => setBugOpen(false)} screenshot={null} />
    </Prim.Box>
  );
}
