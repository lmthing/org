import * as Prim from '../../elements/primitives/index.js';
import React from 'react';
import { useStore } from '../store/store.js';
import type { WireEvent } from '../store/model.js';

/** Parse NDJSON text into WireEvents, tolerating a partial final line.
 *  Accepts both {seq,event} lines and bare TraceEvent lines (assigns seq by order). */
export function parseTrace(text: string): WireEvent[] {
  const out: WireEvent[] = [];
  let seq = 0;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(t); } catch { continue; }
    if (parsed && typeof parsed === 'object' && 'event' in (parsed as object) && 'seq' in (parsed as object)) {
      out.push(parsed as WireEvent);
    } else {
      out.push({ seq: ++seq, event: parsed as WireEvent['event'] });
    }
  }
  // Normalize seq to be monotonic if the file used {seq,event} form
  out.forEach((e, i) => { if (typeof e.seq !== 'number') e.seq = i + 1; });
  return out;
}

export function TraceLoader(): React.ReactElement {
  const loadReplay = useStore((s) => s.loadReplay);
  const onFile = async (f: File) => {
    const text = await f.text();
    loadReplay(parseTrace(text));
  };
  return (
    <Prim.Text as="label" color="var(--lm-muted)" cursor="pointer" hoverStyle={{ color: "var(--lm-text)" }}>
      <Prim.TextField
        type="file"
        accept=".jsonl,.json,.ndjson"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }}
      />
      📂 Load trace
    </Prim.Text>
  );
}

export function PlaybackBar(): React.ReactElement | null {
  const replay = useStore((s) => s.replay);
  const seek = useStore((s) => s.seek);
  const play = useStore((s) => s.play);
  const pause = useStore((s) => s.pause);
  const setSpeed = useStore((s) => s.setSpeed);
  const exitReplay = useStore((s) => s.exitReplay);

  // Drive the playback clock.
  React.useEffect(() => {
    if (!replay?.playing) return;
    const id = setInterval(() => {
      const st = useStore.getState();
      if (!st.replay) return;
      const next = st.replay.cursor + st.replay.speed;
      if (next >= st.replay.events.length) { st.seek(st.replay.events.length); st.pause(); }
      else st.seek(next);
    }, 120);
    return () => clearInterval(id);
  }, [replay?.playing, replay?.speed]);

  if (!replay) return null;
  const total = replay.events.length;
  return (
    <Prim.Row borderColor="var(--lm-border)" backgroundColor="var(--lm-panel)" gap="$2" paddingHorizontal="$3" paddingVertical="$2" borderTopWidth={1} alignItems="center">
      <Prim.Pressable onClick={() => (replay.playing ? pause() : play())} color="var(--lm-accent)" fontSize="13px" width="$6">
        {replay.playing ? '⏸' : '▶'}
      </Prim.Pressable>
      <Prim.TextField
        type="range"
        min={0}
        max={total}
        value={replay.cursor}
        onChange={(e) => seek(Number(e.target.value))}
        className="flex-1 accent-[var(--agent)]"
        data-testid="replay-scrubber"
      />
      <Prim.Text color="var(--lm-muted)" fontSize="10px" fontFamily="$mono" width="$20" textAlign="right">{replay.cursor}/{total}</Prim.Text>
      <Prim.Select
        value={replay.speed}
        onChange={(e) => setSpeed(Number(e.target.value))}
        className="bg-lm-bg border border-lm-border rounded text-[11px] text-lm-text px-1 py-0.5"
      >
        {[1, 2, 4, 8].map((s) => <Prim.Option key={s} value={s}>{s}×</Prim.Option>)}
      </Prim.Select>
      <Prim.Pressable onClick={exitReplay} color="var(--lm-muted)" hoverStyle={{ color: "var(--lm-text)" }}>✕ live</Prim.Pressable>
    </Prim.Row>
  );
}
