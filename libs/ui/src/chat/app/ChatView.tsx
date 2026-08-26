import * as Prim from '../../elements/primitives/index';
import React from 'react';
import { useStore } from '../store/store';
import type { UploadedAttachment } from '../store/model';
import { groupBlocks } from './group-blocks';
import { Message, AssistantTurn } from './Message';
import { Composer } from './Composer';
import { StatusLine } from './StatusLine';
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
  const sessionCostUsd = useStore(s => s.sessionCostUsd + s.sessionCostInflight);
  const projects = useStore(s => s.projects);
  const activeProjectId = useStore(s => s.activeProjectId);
  const model = useStore(s => s.model);
  // Only read to KEY the Composer below — see the note at that call site. Nothing here reacts to
  // it directly; a change remounts the Composer instead.
  const activeSessionId = useStore(s => s.activeSessionId);
  const follow = useStore(s => s.follow);
  const setFollow = useStore(s => s.setFollow);
  const noteUser = useStore(s => s.noteUserMessage);
  const mode = useStore(s => s.mode);
  const [theme, , toggleTheme] = useTheme();
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = React.useState(true);

  const blocks = model?.blocks ?? [];
  // `groupBlocks` walked every block on EVERY render with no memoization — harmless for a short
  // session, increasingly not for a long one: each streamed token batch re-ran it (and, with it,
  // every finished message's markdown/code-block parse) for content that had not changed at all.
  //
  // Two dependencies, not one, because `model.blocks` is a MUTATED array, not a rebuilt one
  // (`feedLive` in `session-slice.ts` calls `m.blocks.push(...)` on the same object session after
  // session) — `blocks.length` is what actually changes when a new block arrives, while `blocks`
  // itself only gets a new reference on `resetSession` (a session switch). Depending on the array
  // reference alone would never re-group a growing conversation; depending on the length alone
  // would risk reusing a stale grouping across two sessions that happen to have the same block
  // count at switch time.
  const groups = React.useMemo(() => groupBlocks(blocks), [blocks, blocks.length]);

  // Auto-scroll to bottom when following.
  //
  // Driven through `Prim.Scroll`'s `stickToEnd` prop below, not an effect: the transcript IS a
  // `Prim.Scroll` (a real `ScrollView` on native), and `stickToEnd` is wired to each target's own
  // measurement moment (`onContentSizeChange` on native, a layout effect on web — see the
  // primitive). An effect calling `scrollIntoView` here would be a DOM method the ref holds no
  // native equivalent for — a no-op on a phone, silently, which is exactly how the transcript
  // stopped following new output there. (This comment used to claim "the transcript is a `Box`,
  // not a `ScrollView`" — stale; it already is one, see below.)

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
          {/* The outer `Prim.Box` is an RN `View` — its `fontSize`/`fontWeight`/`color` style the
              row, not the nested `Prim.Text`, which needs its own copy or the session title renders
              at body size/weight/ink on a device. */}
          <Prim.Box fontSize="$sm" fontWeight="$medium" color="$foreground" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap"><Prim.Text fontSize="$sm" fontWeight="$medium" color="$foreground">{title}</Prim.Text></Prim.Box>
        </Prim.Box>
        {sessionCostUsd > 0 && (
          <Prim.Text fontSize="$xs" color="$muted-foreground" flexShrink={0} title="Session cost">
            {formatCost(sessionCostUsd)}
          </Prim.Text>
        )}
        {/* The one status a phone still needs even with the rest of the workbench hidden: if the
            socket drops the app just looks stuck otherwise, with nothing telling the reader why.
            It used to live inside the row below and disappear with it below `md` — a single glyph,
            so it always renders regardless of breakpoint. */}
        <ConnectionDot />

        {/* The workbench controls — everything that is a DEVELOPER affordance rather than part of
            chatting. A phone is 360dp wide: seven of these plus the title do not fit, and the ones
            that fought hardest for the room are the ones a touch user cannot even use (`Load trace`
            opens a file picker; `Restart CLI` restarts a local process). They are hidden below the
            `md` breakpoint — base styles ARE the mobile styles here, `$md` is the desktop override —
            leaving the phone header as hamburger · title · cost · connection · theme. */}
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
      {/* `Prim.Scroll`, not a `Box` with `overflowY: auto` — Yoga has no overflow scrolling, so on
          a phone the transcript was CLIPPED at one screenful with no gesture to reach the rest, and
          long output ran under the composer. `stickToEnd` follows the conversation on both targets;
          see the primitive for why that is a prop and not an effect. */}
      <Prim.Scroll as="main"
        ref={scrollRef}
        stickToEnd={follow && atBottom}
        flexGrow={1} flexShrink={1} flexBasis="0%"
        onScroll={handleScroll}
        aria-label="conversation"
        aria-live="polite"
        aria-atomic="false"
      >
        {/* `width="100%"` is load-bearing, not belt-and-braces. Yoga does not stretch a child of a
            scroll view to the viewport the way a block element does on web, so with only a
            `maxWidth` this column sized to its CONTENT and `marginHorizontal: auto` then centred
            that — which on a 360dp phone left a ~40dp gutter down the left of every assistant turn
            and a mismatched one on the right, reading as "the replies are pushed off to the side".
            Stating the width makes `maxWidth` the cap it was meant to be on a wide window, and a
            no-op on a narrow one. */}
        {/* `justifyContent: flex-end` once there IS a conversation, so a short one sits against the
            composer rather than floating at the top of an empty screen. `Prim.Scroll`'s own
            bottom-anchoring cannot do it here: this column asks for `minHeight: 100%` (so the empty
            state can fill and centre), which leaves the Scroll no free space to give its spacer.
            Safe on this element specifically — it is not the scrolling box, so end-alignment cannot
            make the overflow unreachable the way it would one level up. Gated on having content,
            because the empty state wants to stay centred. */}
        <Prim.Col
          width="100%"
          maxWidth={768}
          marginHorizontal="auto"
          paddingVertical="$6"
          minHeight="100%"
          {...(groups.length ? { justifyContent: 'flex-end' as const } : {})}
        >
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
      </Prim.Scroll>

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

      {/* Between the transcript and the input — what a reader wants within a glance of the box
          they are typing into. Where this project's app LIVES used to be a chip row here; it is
          a property of the project, not of any one turn, so it moved to the sidebar's `APP`
          section beside that project's spaces and conversations
          (`elements/nav/app-sidebar`, fed by `chat/app/use-app-pages.ts`). */}

      {/* The one live "currently doing" sentence — a running sub-agent's narration when one is in
          flight, otherwise THING's own setActivity line. */}
      <StatusLine />

      {/* Composer */}
      {/* Keyed on the session: `Composer` holds its draft (`text`/`attachments`/`recording`/
          `dropdownOpen`) as local state that nothing ever reset on a session switch, because
          neither this component nor `Composer` unmounts when `switchSession` swaps the socket —
          so a draft typed in one chat was still sitting in the box after switching to another,
          one keystroke away from being sent into the wrong conversation. A `key` change forces
          React to tear down and remount `Composer` fresh, which resets everything at once rather
          than each field needing its own effect. */}
      <Composer key={activeSessionId} onSend={handleSend} projectId={projectId} />

      <BugReportDialog open={bugOpen} onClose={() => setBugOpen(false)} screenshot={null} />
    </Prim.Box>
  );
}
