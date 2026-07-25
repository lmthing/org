import { useStore, type InspectorTab } from '../store/store';

// ─── URL ↔ state sync (deep-linkable; LLM-friendly) ─────────────────────────
// ?node=<id>&tab=<tab>&follow=0

export function applyUrlToState(): void {
  const params = new URLSearchParams(window.location.search);
  const node = params.get('node');
  const tab = params.get('tab') as InspectorTab | null;
  const follow = params.get('follow');
  const st = useStore.getState();
  if (node) st.selectNode(node, true);
  if (tab) st.setTab(tab);
  if (follow === '0') st.setFollow(false);
}

/** Subscribe store changes back into the URL. Returns an unsubscribe fn. */
export function syncStateToUrl(): () => void {
  let lastKey = '';
  return useStore.subscribe((s) => {
    const key = `${s.selectedNodeId ?? ''}|${s.tab}|${s.follow ? 1 : 0}`;
    if (key === lastKey) return;
    lastKey = key;
    const params = new URLSearchParams(window.location.search);
    if (s.selectedNodeId) params.set('node', s.selectedNodeId); else params.delete('node');
    params.set('tab', s.tab);
    if (!s.follow) params.set('follow', '0'); else params.delete('follow');
    const url = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, '', url);
  });
}
