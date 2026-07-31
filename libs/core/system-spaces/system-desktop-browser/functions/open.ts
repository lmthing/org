// This file drives the browser running in the person's LMThing DESKTOP APP — the one visible in
// the app's Browser pane, signed into their real accounts. It is one of a family of thin,
// self-contained wrappers (per the "space functions are self-contained" rule) that forward a
// JSON-RPC `tools/call` to the desktop over the pod's host bridge.
//
// Endpoint: `LMTHING_DESKTOP_BROWSER_URL`, published by the pod only while a desktop is attached
// (libs/cli/src/host/browser-endpoint.ts). Its own variable rather than `LIGHTPANDA_MCP_URL`: if
// these read that one, a pod with a headless browser and no desktop would silently drive THAT,
// reporting pages nobody can see. Unset means "no desktop", and that is what the error says.
//
// Browser state — the current tab, cookies, scroll position — lives in the real browser, so calls
// are stateful across the turn and across agents.

/**
 * Navigate the visible browser to a URL and wait for the document to be ready. Returns the final URL and page title — which may differ from the one requested if the site redirected.
 */
export async function open(args: { url: string }): Promise<{ ok: boolean; text: string; isError: boolean; error?: string }> {
  const endpoint = process.env['LMTHING_DESKTOP_BROWSER_URL'];
  if (!endpoint) {
    return { ok: false, text: '', isError: true, error: 'no LMThing desktop app is attached to this workspace — the browser lives on the person\'s computer, so open the desktop app and connect it under Local access, then try again' };
  }
  const request = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'open', arguments: args } };
  let res: { ok: boolean; status: number; json: () => unknown; text: () => string };
  try {
    res = await fetch(endpoint.replace(/\/+$/, ''), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(request),
    });
  } catch (e) {
    return { ok: false, text: '', isError: true, error: `the desktop app did not answer (${String(e)}) — it may have been closed` };
  }
  if (!res.ok) {
    return { ok: false, text: '', isError: true, error: `the desktop browser bridge returned HTTP ${res.status}` };
  }
  const rpc = res.json() as { result?: { content?: Array<{ type?: string; text?: string }>; isError?: boolean }; error?: { code?: number; message?: string } };
  if (rpc.error) {
    return { ok: false, text: '', isError: true, error: rpc.error.message ?? `bridge error ${rpc.error.code ?? ''}`.trim() };
  }
  const text = (rpc.result?.content ?? []).map((c) => c.text ?? '').join('\n');
  const failed = rpc.result?.isError === true;
  return { ok: !failed, text, isError: failed };
}
