import { test, expect, type Page } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The browser pane, against a REAL Chromium.
 *
 * ## Why this one is not a stub
 *
 * Everything else about the pane can be unit-tested — the coordinate arithmetic, the key
 * translation, the tool catalogue all have suites. What none of them can prove is the thing the
 * feature actually is: that frames arrive and keep arriving, and that a click on a picture of a
 * page reaches the page.
 *
 * Both fail in ways no assertion against a stub would notice. Screencast frames stop after two or
 * three if they are not acknowledged, with no error — it looks exactly like a page that stopped
 * changing. A coordinate off by a letterbox margin clicks the wrong element and reports success.
 * So this spec launches a genuine Chromium, points the app's `browser_start` at it, and asserts on
 * what the PAGE did — through the app's own UI, never by reaching around it.
 *
 * The app still runs in Playwright's Chromium (a Tauri webview is not scriptable), so this proves
 * the application's half. `cargo test` proves the launch flags and the port file.
 */

const STUB_PORT = Number(process.env.STUB_PORT || 4411)
const STUB = `http://127.0.0.1:${STUB_PORT}`
const DEV_CODE = '424242'

const BRIDGE = {
  protocolVersion: 1,
  platform: 'linux',
  mode: 'cloud',
  apiBase: STUB,
  cloudBase: STUB,
  teamBase: STUB,
  comBase: STUB,
}

interface RealBrowser {
  child: ChildProcess
  profile: string
  wsUrl: string
  port: number
}

/**
 * Launch a Chromium exactly as `src-tauri/src/browser.rs` does.
 *
 * The flags are duplicated here rather than shared, deliberately: this is the *test's* browser, and
 * if the two ever disagree the Rust suite's `the_flags_the_connection_depends_on_are_present` is
 * what should catch it. A test that imported the real flag list could not fail when they changed.
 */
async function launchRealChromium(): Promise<RealBrowser> {
  const bin =
    process.env.PW_CHROMIUM ||
    `${process.env.HOME}/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome`
  const profile = await mkdtemp(join(tmpdir(), 'lmthing-pane-'))
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
  )

  // The same two-line file `read_devtools_endpoint` parses, and the same reason for insisting on
  // BOTH lines: the file exists before it is fully written.
  const portFile = join(profile, 'DevToolsActivePort')
  for (let i = 0; i < 100; i++) {
    try {
      const text = await readFile(portFile, 'utf8')
      const [portLine, path] = text.split('\n')
      if (portLine && path?.startsWith('/')) {
        const port = Number(portLine.trim())
        return { child, profile, port, wsUrl: `ws://127.0.0.1:${port}${path.trim()}` }
      }
    } catch {
      /* not written yet */
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  child.kill()
  throw new Error('the test browser never reported a debugging port')
}

let browser: RealBrowser

test.beforeAll(async () => {
  browser = await launchRealChromium()
})

test.afterAll(async () => {
  browser?.child.kill()
  if (browser?.profile) await rm(browser.profile, { recursive: true, force: true }).catch(() => {})
})

/** `browser_start` hands back the real Chromium; nothing else about the pane is stubbed. */
async function installStubs(page: Page) {
  await page.addInitScript(
    ({ bridge, endpoint }) => {
      ;(window as unknown as Record<string, unknown>)['__LMTHING_DESKTOP__'] = bridge
      ;(window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {
        invoke: (cmd: string) => {
          if (cmd === 'browser_start') return Promise.resolve(endpoint)
          if (cmd === 'grant_list') return Promise.resolve([])
          if (cmd === 'grant_list_detailed') return Promise.resolve([])
          return Promise.resolve(null)
        },
      }
    },
    { bridge: BRIDGE, endpoint: { wsUrl: browser.wsUrl, port: browser.port, headless: true } },
  )
}

async function signInAndOpenBrowser(page: Page) {
  await installStubs(page)
  await page.goto('/')
  await page.getByPlaceholder('you@example.com').fill('someone@example.test')
  await page.getByRole('button', { name: /continue with email/i }).click()
  await page.getByPlaceholder('123456').fill(DEV_CODE)
  await page.getByRole('button', { name: /sign in|continue/i }).first().click()
  await expect(page.getByText(/good (morning|afternoon|evening)/i)).toBeVisible({ timeout: 20_000 })

  await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByRole('button', { name: 'Browser' }).click()
}

/** The rendered frame. Its presence at all is the proof that the screencast is running. */
const framePane = (page: Page) => page.locator('img[src^="data:image/jpeg"]')

async function navigateTo(page: Page, url: string) {
  const address = page.getByLabel('Address')
  await address.click()
  await address.fill(url)
  await address.press('Enter')
}

test.beforeEach(async ({ page }) => {
  await page.request.get(`${STUB}/__reset`)
  await page.addInitScript(() => {
    try {
      window.localStorage.clear()
    } catch {
      /* first navigation may not have storage yet */
    }
  })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  // Same guard as `shell.spec.ts`: several assertions below are about content APPEARING, and a
  // boot-time exception would make them fail for a reason nobody would look for.
  ;(page as unknown as { __errors: string[] }).__errors = errors
})

test.afterEach(async ({ page }) => {
  expect((page as unknown as { __errors: string[] }).__errors).toEqual([])
})

test('streams frames from a real browser, and keeps streaming', async ({ page }) => {
  await signInAndOpenBrowser(page)
  await expect(framePane(page)).toBeVisible({ timeout: 30_000 })

  // The ack test. Chromium keeps a small number of frames in flight and stops entirely once they
  // go unacknowledged — so a client that renders but never acks shows two or three frames and then
  // a still image forever. Navigating and requiring the picture to CHANGE afterwards is what
  // distinguishes a live stream from a frozen one.
  const first = await framePane(page).getAttribute('src')
  await navigateTo(page, `${STUB}/__page/click`)
  await expect
    .poll(async () => framePane(page).getAttribute('src'), { timeout: 30_000 })
    .not.toBe(first)
})

test('the address bar navigates the real browser, and the tab strip follows', async ({ page }) => {
  await signInAndOpenBrowser(page)
  await expect(framePane(page)).toBeVisible({ timeout: 30_000 })

  await navigateTo(page, `${STUB}/__page/click`)
  // The tab's title comes from `Target.targetInfoChanged` on the real browser — so this asserts
  // that the app is reading the actual page, not echoing what was typed.
  await expect(page.getByText('click me')).toBeVisible({ timeout: 30_000 })
})

test('a click in the pane reaches the page', async ({ page }) => {
  await signInAndOpenBrowser(page)
  await expect(framePane(page)).toBeVisible({ timeout: 30_000 })
  await navigateTo(page, `${STUB}/__page/click`)
  await expect(page.getByText('click me')).toBeVisible({ timeout: 30_000 })

  // The page is one full-viewport button whose handler renames the document. Clicking the middle
  // of the pane must therefore change the title — which the tab strip shows. Asserted through the
  // app's own UI rather than by opening a second CDP connection, because the question is whether
  // THE APP forwarded the click correctly.
  await page.locator('[role="application"][aria-label="Browser"]').click()
  await expect(page.getByText('was clicked')).toBeVisible({ timeout: 30_000 })
})

test('typing in the pane reaches the page', async ({ page }) => {
  await signInAndOpenBrowser(page)
  await expect(framePane(page)).toBeVisible({ timeout: 30_000 })
  await navigateTo(page, `${STUB}/__page/type`)
  await expect(page.getByText('type here')).toBeVisible({ timeout: 30_000 })

  await page.locator('[role="application"][aria-label="Browser"]').click()
  await page.keyboard.type('hello')
  // Proves `text` is set on keyDown: without it the key events arrive, the page sees keydown, and
  // NOTHING is typed — an `oninput` handler never fires at all.
  await expect(page.getByText('typed: hello')).toBeVisible({ timeout: 30_000 })
})

test('the browser is not started until the pane is opened', async ({ page }) => {
  await installStubs(page)
  await page.goto('/')
  await page.getByPlaceholder('you@example.com').fill('someone@example.test')
  await page.getByRole('button', { name: /continue with email/i }).click()
  await page.getByPlaceholder('123456').fill(DEV_CODE)
  await page.getByRole('button', { name: /sign in|continue/i }).first().click()
  await expect(page.getByText(/good (morning|afternoon|evening)/i)).toBeVisible({ timeout: 20_000 })

  // A browser signed into somebody's accounts, reachable by a cloud agent, must not appear because
  // an app was launched. Opening the pane is the explicit act.
  await expect(framePane(page)).toHaveCount(0)
})
