import { useStore, type InspectorTab } from '../store/store';
import { readLinkParams, writeLinkParams } from '../../platform/deep-link';

// ─── Deep link ↔ state sync (linkable; LLM-friendly) ────────────────────────
// `?node=<id>&tab=<tab>&follow=0` on web; the same names, held in memory and seeded from the launch
// URL, on native. This file is ONE file on purpose — only the channel differs, and that lives in
// `platform/deep-link`. See that module for why the write is a patch rather than a replacement.

export function applyUrlToState(): void {
  const params = readLinkParams();
  const node = params.node;
  const tab = params.tab as InspectorTab | undefined;
  const follow = params.follow;
  const st = useStore.getState();
  if (node) st.selectNode(node, true);
  if (tab) st.setTab(tab);
  if (follow === '0') st.setFollow(false);
}

/** Subscribe store changes back into the deep-link params. Returns an unsubscribe fn. */
export function syncStateToUrl(): () => void {
  let lastKey = '';
  return useStore.subscribe((s) => {
    const key = `${s.selectedNodeId ?? ''}|${s.tab}|${s.follow ? 1 : 0}`;
    if (key === lastKey) return;
    lastKey = key;
    // Key order is preserved from the original: node, then tab, then follow. `URLSearchParams.set`
    // appends a new key at the end, so a different order here would reorder the query string of
    // every chat URL for no reason.
    writeLinkParams({
      node: s.selectedNodeId ?? null,
      tab: s.tab,
      follow: s.follow ? null : '0',
    });
  });
}
