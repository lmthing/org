#!/usr/bin/env node
/**
 * A stand-in for the gateway AND the pod, on ONE port that is deliberately NOT the port serving the
 * bundle.
 *
 * That separation is the point of the whole harness. The desktop shell is the only client whose
 * origin (`tauri://localhost`) is not the pod, so every request it makes has to be rewritten by
 * `apiBase()`/`cloudBase` from the injected bridge. Serving the API on a second port means a
 * regression in that seam does not produce a subtly wrong request — it produces a 404 against the
 * static server, and the test fails loudly.
 *
 * Every handler records what it received, and `GET /__calls` hands the log back to the test, so
 * assertions can be about what the app ACTUALLY asked the network for rather than about what
 * appeared on screen.
 */
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'

const PORT = Number(process.env.STUB_PORT || 4411)

/** The code the "mail" would have contained. Fixed, so the test can type it. */
export const DEV_CODE = '424242'

const calls = []

function record(req, body) {
  calls.push({ method: req.method, path: new URL(req.url, 'http://x').pathname, body })
}

function json(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json',
    // The bundle is served from a different origin, exactly as it is in the real app, so every
    // one of these needs CORS. `credentials: 'include'` on the email-start call means the
    // wildcard origin is NOT usable — it must echo the caller.
    'access-control-allow-origin': extraHeaders.origin ?? '*',
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'content-type,authorization',
    'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
  })
  res.end(payload)
}

function html(res, body) {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(`<!doctype html><meta charset="utf-8">${body}`)
}

const SESSION = {
  access_token: 'e2e-access-token',
  refresh_token: 'e2e-refresh-token',
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: {
    id: 'e2e-user',
    email: 'someone@example.test',
    github_repo: null,
    github_username: null,
  },
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const path = url.pathname
  const origin = req.headers.origin

  if (req.method === 'OPTIONS') return json(res, 204, {}, { origin })

  let body = null
  if (req.method !== 'GET') {
    const chunks = []
    for await (const c of req) chunks.push(c)
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    } catch {
      body = null
    }
  }
  record(req, body)

  // ── pages for the real Chromium the browser-pane spec drives ───────────────
  // Served from here rather than a file:// URL so the browser under test makes an ordinary
  // network request, exactly as it would for any site. Each page reports what happened to it
  // through `document.title`, which the pane's tab strip displays — so the assertion can be made
  // on the app's own UI rather than by reaching around it into the browser.
  if (path === '/__page/click') {
    return html(
      res,
      `<title>click me</title><body style="margin:0">
       <button style="width:100vw;height:100vh;font-size:48px"
               onclick="document.title='was clicked'">Click anywhere</button>`,
    )
  }
  if (path === '/__page/type') {
    return html(
      res,
      `<title>type here</title><body style="margin:0">
       <input id="i" autofocus style="width:100vw;height:100vh;font-size:48px"
              oninput="document.title='typed: '+this.value">`,
    )
  }

  // ── the harness's own introspection ────────────────────────────────────────
  if (path === '/__calls') return json(res, 200, { calls }, { origin })
  if (path === '/__bridge') return json(res, 200, bridge, { origin })
  if (path === '/__reset') {
    calls.length = 0
    bridge.grants = null
    bridge.results.length = 0
    return json(res, 200, { ok: true }, { origin })
  }

  // ── gateway ────────────────────────────────────────────────────────────────
  if (path === '/api/auth/email/start') {
    return json(
      res,
      200,
      { email: 's••••@example.test', expires_at: Math.floor(Date.now() / 1000) + 600, dev_code: DEV_CODE },
      { origin },
    )
  }
  if (path === '/api/auth/email/verify') {
    if (body?.code !== DEV_CODE) return json(res, 400, { error: 'That code did not work' }, { origin })
    return json(res, 200, SESSION, { origin })
  }
  if (path === '/api/auth/refresh') return json(res, 200, SESSION, { origin })
  if (path === '/api/compute/ensure') return json(res, 200, { ok: true }, { origin })
  if (path === '/api/compute/wake') return json(res, 202, { ok: true }, { origin })
  if (path === '/api/teams') {
    return json(res, 200, { teams: [{ id: 'team-1', name: 'Acme', role: 'editor', created_at: '2026-01-01' }] }, { origin })
  }
  if (path === '/api/teams/team-1/token') {
    return json(res, 200, { access_token: 'team-token', expires_at: SESSION.expires_at, role: 'editor' }, { origin })
  }

  // ── team pod (`/api/team/*`) ───────────────────────────────────────────────
  //
  // These are answered with REAL shapes rather than `{}`, and that is not politeness. The team
  // surface destructures them straight into `useMemo` bodies (`chat.channels.find(...)`,
  // `chat.directory.projects.filter(...)`), so a missing key is not an empty list — it is a
  // TypeError that unmounts the whole React tree. `HomeShell` mounts Teams at the same moment as
  // Home, so that crash takes the Home dashboard with it.
  if (path === '/api/team/channels') {
    return json(
      res,
      200,
      {
        channels: [{ id: 'c1', name: 'general', kind: 'text', categoryId: null, position: 0 }],
        categories: [],
        unread: [],
      },
      { origin },
    )
  }
  if (path === '/api/team/directory') {
    return json(res, 200, { members: [], projects: [] }, { origin })
  }
  if (path === '/api/team/profile') return json(res, 200, { profile: null }, { origin })
  if (path.startsWith('/api/team/messages') || path.match(/^\/api\/team\/channels\/[^/]+\/messages/)) {
    return json(res, 200, { messages: [], hasMore: false }, { origin })
  }

  // ── pod ────────────────────────────────────────────────────────────────────
  // `waitForPodEdge` polls this until it stops answering 503/504. Answering 200 immediately is
  // what makes the boot deterministic; the retry path has its own unit coverage.
  if (path === '/api/sessions') return json(res, 200, { sessions: [] }, { origin })
  if (path === '/api/projects') return json(res, 200, { projects: [] }, { origin })
  if (path === '/api/spaces') return json(res, 200, { spaces: [] }, { origin })
  if (path === '/api/env') return json(res, 200, { vars: {} }, { origin })
  if (path === '/api/budget') return json(res, 200, {}, { origin })
  if (path.startsWith('/api/')) return json(res, 200, {}, { origin })

  json(res, 404, { error: 'not found' }, { origin })
})

/**
 * `/api/host/ws` — the pod half of the desktop bridge.
 *
 * Plays the pod for real: greets with `hello`, waits for the desktop's `grants` push, then issues
 * an `fs.request` and records the answer. That makes the E2E a genuine protocol round trip rather
 * than a check that a socket opened.
 */
const wss = new WebSocketServer({ noServer: true })
/** What the desktop told us, and what it answered — read back by the test via `/__bridge`. */
const bridge = { grants: null, results: [] }

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url ?? '/', 'http://x')
  if (pathname !== '/api/host/ws') {
    socket.destroy()
    return
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    calls.push({ method: 'WS', path: pathname, body: null })
    ws.send(JSON.stringify({ type: 'hello', protocolVersion: 1, podId: 'stub-pod' }))
    ws.on('message', (data) => {
      let msg
      try {
        msg = JSON.parse(data.toString())
      } catch {
        return
      }
      if (msg.type === 'grants') {
        bridge.grants = msg.roots
        // The pod asks for something the moment it knows what exists — which is what the test
        // needs in order to observe a full request/response cycle.
        ws.send(JSON.stringify({ type: 'fs.request', id: 'req-1', op: 'tree', rootId: msg.roots?.[0]?.id ?? 'none' }))
        return
      }
      if (msg.type === 'result') bridge.results.push(msg)
    })
  })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[stub-backend] gateway+pod on http://127.0.0.1:${PORT}`)
})
