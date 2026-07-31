/**
 * A desktop, attached to a real pod, driving a real browser.
 *
 * ## What this is, and what it is not
 *
 * It is the **desktop's own shipped code** — `apps/desktop/src/cdp.ts` and
 * `apps/desktop/src/browser-tools.ts`, imported directly — dialling a real pod's `/api/host/ws`
 * and answering its `browser.request` frames against a real Chromium. Nothing is reimplemented
 * here: a second copy of `callTool` would drift from the one that ships, and a scenario passing
 * against the copy would prove nothing about the product.
 *
 * It is **not the Tauri shell**. There is no window, no `invoke`, no `grants.rs`. Those have their
 * own suites (`cargo test`, and the Playwright specs that drive the real bundle). What this proves
 * is the half neither of those can reach: that a pod, an agent turn, and a browser on this machine
 * meet correctly over the wire.
 *
 * Both files import cleanly into Node because they use only `WebSocket`, `fetch`, timers and JSON —
 * all globals in Node 24 — which is why this harness runs under `tsx` rather than compiling
 * anything.
 *
 * ## The filesystem is refused, deliberately
 *
 * This harness answers `fs.request` with a refusal. The security boundary for local files is
 * `grants.rs`, in Rust, and standing in for it with a JavaScript approximation would be the exact
 * mistake the design exists to prevent — a scenario would then be exercising the stand-in's rules,
 * not the product's.
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

/** Must match `HOST_PROTOCOL_VERSION` in `libs/cli/src/rpc/host-events.ts`. */
const HOST_PROTOCOL_VERSION = 1;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Find a Chromium to drive.
 *
 * `LMTHING_BROWSER` first — the same variable `browser.rs#find_browser` honours, so a scenario and
 * the real app can be pointed at one binary. Otherwise whatever Playwright has downloaded, then
 * whatever is on PATH.
 */
export function findChromium() {
  if (process.env.LMTHING_BROWSER && existsSync(process.env.LMTHING_BROWSER)) {
    return process.env.LMTHING_BROWSER;
  }
  const cache = join(homedir(), '.cache', 'ms-playwright');
  const versions = existsSync(cache)
    ? readdirSync(cache)
        .filter((d) => d.startsWith('chromium-'))
        .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
    : [];
  for (const v of versions) {
    for (const layout of [
      'chrome-linux64/chrome',
      'chrome-linux/chrome',
      'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
    ]) {
      const p = join(cache, v, layout);
      if (existsSync(p)) return p;
    }
  }
  for (const dir of (process.env.PATH ?? '').split(':')) {
    for (const name of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']) {
      const p = join(dir, name);
      if (existsSync(p)) return p;
    }
  }
  throw new Error('no Chromium found — set LMTHING_BROWSER, or run `pnpm exec playwright install chromium`');
}

/**
 * Launch Chromium with the flags `browser.rs#launch_args` uses.
 *
 * Duplicated rather than shared, on purpose: this is the scenario's browser, and if the two lists
 * ever disagree it is `cargo test`'s `the_flags_the_connection_depends_on_are_present` that should
 * fail — a harness importing the real list could not.
 */
export async function launchChromium() {
  const bin = findChromium();
  const profile = await mkdtemp(join(tmpdir(), 'lmthing-scenario-browser-'));
  const child = spawn(
    bin,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      '--remote-allow-origins=*',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1280,800',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  // The same two-line file `read_devtools_endpoint` parses, and the same insistence on BOTH lines:
  // the file exists before it is fully written, and a port with no path yields a socket URL that
  // connects to nothing.
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 150; i++) {
    try {
      const text = await readFile(portFile, 'utf8');
      const [portLine, path] = text.split('\n');
      if (portLine && path?.startsWith('/')) {
        const port = Number(portLine.trim());
        return {
          child,
          profile,
          endpoint: { wsUrl: `ws://127.0.0.1:${port}${path.trim()}`, port, headless: true },
          async close() {
            child.kill();
            await rm(profile, { recursive: true, force: true }).catch(() => {});
          },
        };
      }
    } catch {
      /* not written yet */
    }
    await sleep(100);
  }
  child.kill();
  throw new Error('the scenario browser never reported a debugging port');
}

/**
 * Attach a desktop to `pod`, with a live browser behind it.
 *
 * @param {object} o
 * @param {string} o.base   the pod origin — `https://lmthing.chat` in prod, where Envoy routes on
 *                          the token's `sub` claim exactly as it does for the chat socket.
 * @param {string} o.token  the gateway JWT.
 * @param {boolean} [o.verbose]
 * @returns a handle with `.ops` (everything the pod asked for), `.hello`, and `.close()`.
 */
export async function attachDesktop({ base, token, verbose = false }) {
  const { CdpClient } = await import('../../../apps/desktop/src/cdp.ts');
  const { callTool } = await import('../../../apps/desktop/src/browser-tools.ts');

  const browser = await launchChromium();
  const cdp = new CdpClient();
  await cdp.connect(browser.endpoint);

  const log = (...a) => verbose && console.log('[desktop]', ...a);
  const ops = [];
  let hello = null;
  let closed = false;

  const wsBase = base.replace(/^http/, 'ws');
  const url = `${wsBase}/api/host/ws?access_token=${encodeURIComponent(token)}`;
  const socket = new WebSocket(url);

  const connected = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the pod never accepted the host bridge')), 30_000);
    socket.addEventListener('open', () => {
      clearTimeout(timer);
      log('connected', base);
      // Grants pushed even though every one of them is refused below: the pod's own bridge sends
      // this at connect, and a harness that skipped it would be speaking a slightly different
      // protocol than the app does.
      socket.send(JSON.stringify({ type: 'grants', roots: [] }));
      resolve();
    });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error(`the pod refused the host bridge at ${base}`));
    });
  });

  socket.addEventListener('close', (ev) => {
    if (!closed) log('socket closed', ev.code, ev.reason);
  });

  socket.addEventListener('message', async (ev) => {
    let frame;
    try {
      frame = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    const send = (msg) => socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify(msg));

    switch (frame.type) {
      case 'hello': {
        hello = frame;
        if (frame.protocolVersion !== HOST_PROTOCOL_VERSION) {
          ops.push({ op: 'hello', ok: false, error: `protocol ${frame.protocolVersion}` });
        }
        log('hello', frame.podId, 'protocol', frame.protocolVersion);
        return;
      }
      case 'evicted': {
        ops.push({ op: 'evicted', ok: false, error: frame.reason });
        return;
      }
      case 'fs.request': {
        // See the header: standing in for `grants.rs` would mean testing the stand-in's rules.
        ops.push({ op: `fs.${frame.op}`, ok: false, error: 'refused by the scenario harness' });
        send({
          type: 'result',
          id: frame.id,
          ok: true,
          value: { ok: false, error: 'this scenario grants no folders' },
        });
        return;
      }
      case 'browser.request': {
        const name = frame.body?.params?.name ?? '';
        const args = frame.body?.params?.arguments ?? {};
        const at = Date.now();
        try {
          const result = await callTool(cdp, name, args);
          const text = (result.content ?? []).map((c) => c.text ?? '').join('\n');
          ops.push({ op: name, args, ok: result.isError !== true, ms: Date.now() - at, text });
          log(name, JSON.stringify(args).slice(0, 120), '→', text.slice(0, 160).replace(/\n/g, ' '));
          send({
            type: 'result',
            id: frame.id,
            ok: true,
            value: { jsonrpc: '2.0', id: frame.body?.id ?? 1, result },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          ops.push({ op: name, args, ok: false, ms: Date.now() - at, error: message });
          log(name, 'FAILED', message);
          send({
            type: 'result',
            id: frame.id,
            ok: true,
            value: { jsonrpc: '2.0', id: frame.body?.id ?? 1, error: { code: -32000, message } },
          });
        }
        return;
      }
      case 'cdp.request': {
        // The devtools agent's raw path. Reached only after a person approved the call, which in a
        // scenario means the driver answered the consent card.
        const at = Date.now();
        try {
          if (frame.method === 'subscribe') {
            await cdp.subscribe(String(frame.params?.domain ?? ''));
            send({ type: 'result', id: frame.id, ok: true, value: { ok: true } });
          } else if (frame.method === 'events') {
            send({ type: 'result', id: frame.id, ok: true, value: { ok: true, events: cdp.drainEvents() } });
          } else {
            const result = await cdp.send(frame.method, frame.params ?? {});
            send({ type: 'result', id: frame.id, ok: true, value: { ok: true, result } });
          }
          ops.push({ op: `cdp ${frame.method}`, ok: true, ms: Date.now() - at });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          ops.push({ op: `cdp ${frame.method}`, ok: false, ms: Date.now() - at, error });
          send({ type: 'result', id: frame.id, ok: true, value: { ok: false, error } });
        }
        return;
      }
      default:
        return;
    }
  });

  await connected;

  return {
    ops,
    get hello() {
      return hello;
    },
    /** What the browser is looking at now — read directly, to check the agent's claim. */
    async currentPage() {
      const r = await cdp.send('Runtime.evaluate', {
        expression: 'JSON.stringify({url:location.href,title:document.title,text:document.body?document.body.innerText.slice(0,4000):""})',
        returnByValue: true,
      });
      return JSON.parse(r.result?.value ?? '{}');
    },
    async close() {
      closed = true;
      try {
        socket.close();
      } catch {
        /* already gone */
      }
      cdp.close();
      await browser.close();
    },
  };
}

/**
 * Try to attach, and report a refusal as an OUTCOME rather than throwing.
 *
 * A team pod refuses `/api/host/ws` outright (`server/team-guard.ts`), and that refusal is the
 * whole point of the team scenario — so it must arrive as data the scenario can assert on.
 */
export async function tryAttachDesktop(opts) {
  try {
    const desktop = await attachDesktop(opts);
    return { attached: true, desktop };
  } catch (err) {
    return { attached: false, error: err instanceof Error ? err.message : String(err) };
  }
}
