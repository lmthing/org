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
    <label className="text-[11px] text-lm-muted cursor-pointer hover:text-lm-text">
      <input
        type="file"
        accept=".jsonl,.json,.ndjson"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }}
      />
      📂 Load trace
    </label>
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
    <div className="flex items-center gap-2 px-3 py-2 border-t border-lm-border bg-lm-panel">
      <button onClick={() => (replay.playing ? pause() : play())} className="text-lm-accent text-[13px] w-6">
        {replay.playing ? '⏸' : '▶'}
      </button>
      <input
        type="range"
        min={0}
        max={total}
        value={replay.cursor}
        onChange={(e) => seek(Number(e.target.value))}
        className="flex-1 accent-[#58a6ff]"
        data-testid="replay-scrubber"
      />
      <span className="text-[10px] font-mono text-lm-muted w-20 text-right">{replay.cursor}/{total}</span>
      <select
        value={replay.speed}
        onChange={(e) => setSpeed(Number(e.target.value))}
        className="bg-lm-bg border border-lm-border rounded text-[11px] text-lm-text px-1 py-0.5"
      >
        {[1, 2, 4, 8].map((s) => <option key={s} value={s}>{s}×</option>)}
      </select>
      <button onClick={exitReplay} className="text-[11px] text-lm-muted hover:text-lm-text">✕ live</button>
    </div>
  );
}
