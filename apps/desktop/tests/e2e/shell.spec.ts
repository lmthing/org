import { test, expect, type Page } from '@playwright/test'

/**
 * End-to-end coverage of the desktop shell, driving the REAL production bundle.
 *
 * ## What this proves, and what it does not
 *
 * A Tauri webview cannot be driven by Playwright, so these run in Chromium against the same
 * `dist/` that Tauri embeds, with `window.__LMTHING_DESKTOP__` installed by `addInitScript` —
 * which is exactly what `src-tauri/src/lib.rs` does with `initialization_script`, at the same
 * point in the page lifecycle (before any bundle script).
 *
 * So: **the application** is what is under test here — boot order, the bridge seam, sign-in, pod
 * boot, the surfaces. **The shell** is covered separately by `cargo test` (menu/navigation/config)
 * and by launching the real binary. Neither substitutes for the other, and saying so is the point:
 * a suite that implied it had tested the webview would be worse than no suite.
 */

const STUB_PORT = Number(process.env.STUB_PORT || 4411)
const STUB = `http://127.0.0.1:${STUB_PORT}`
const DEV_CODE = '424242'

/** The object the Rust side injects. Mirrors `config.rs#DesktopBridge`, pointed at the stub. */
const BRIDGE = {
  protocolVersion: 1,
  platform: 'linux',
  mode: 'cloud',
  apiBase: STUB,
  cloudBase: STUB,
  teamBase: STUB,
  comBase: STUB,
}

async function installBridge(page: Page, overrides: Record<string, unknown> = {}) {
  await page.addInitScript((bridge) => {
    ;(window as unknown as Record<string, unknown>)['__LMTHING_DESKTOP__'] = bridge
  }, { ...BRIDGE, ...overrides })
}

async function calls(page: Page): Promise<Array<{ method: string; path: string; body: unknown }>> {
  const res = await page.request.get(`${STUB}/__calls`)
  return (await res.json()).calls
}

/**
 * Every test fails on an uncaught page error.
 *
 * Several assertions below are about the ABSENCE of something (no login screen in demo mode), and
 * a blank page caused by a boot-time exception would satisfy every one of them. Watching for
 * `pageerror` is what makes "it did not render the login screen" mean "it rendered something else"
 * rather than "it rendered nothing".
 */
const pageErrors = new WeakMap<Page, string[]>()

test.beforeEach(async ({ page }) => {
  const errs: string[] = []
  pageErrors.set(page, errs)
  page.on('pageerror', (e) => errs.push(String(e)))

  await page.request.get(`${STUB}/__reset`)
  await page.addInitScript(() => {
    // Each test starts signed out. The shell persists the session in localStorage (the web
    // `session-store`), and a leaked one would make the sign-in tests pass without signing in.
    try {
      window.localStorage.clear()
    } catch {
      /* first navigation may not have storage yet */
    }
  })
})

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page) ?? []).toEqual([])
})

/** The app mounted and painted something — the guard against a vacuous absence assertion. */
async function expectAppRendered(page: Page) {
  await expect(page.locator('#root')).not.toBeEmpty({ timeout: 15_000 })
}

test.describe('boot', () => {
  /**
   * The regression that would have shipped a broken app on two of three platforms.
   *
   * The bundle here is served from `127.0.0.1`, which is precisely the condition
   * `isLocalRun()` treats as "the pod serves this app, skip the auth wall" — and a Tauri webview on
   * macOS/Linux has `location.hostname === 'localhost'` for the same reason. Without the desktop
   * short-circuit the app boots into `DEMO_SESSION` and never shows a login screen.
   *
   * Both directions are asserted, because only the pair distinguishes "the guard works" from
   * "the login screen happens to render anyway".
   */
  test('WITHOUT the bridge, a localhost origin goes into demo mode — the bug', async ({ page }) => {
    await page.goto('/')
    // The app DID mount — otherwise the absence below would be satisfied by a blank page, which is
    // the failure mode this pair of tests exists to distinguish.
    await expectAppRendered(page)
    // No login screen: demo mode hands the app a session called "demo" and walks straight in.
    await expect(page.getByPlaceholder('you@example.com')).toHaveCount(0)
    const stored = await page.evaluate(() => window.localStorage.getItem('lmthing_session'))
    expect(stored).toBeNull()
  })

  test('WITH the bridge, the same origin shows the login screen', async ({ page }) => {
    await installBridge(page)
    await page.goto('/')
    await expect(page.getByPlaceholder('you@example.com')).toBeVisible({ timeout: 15_000 })
  })

  test('a bridge announcing an unknown protocol version is ignored wholesale', async ({ page }) => {
    // Degrading to "not desktop" is the designed failure, so this falls back to demo mode exactly
    // as an un-bridged page does — never to a half-understood object addressing unknown fields.
    await installBridge(page, { protocolVersion: 99 })
    await page.goto('/')
    await expectAppRendered(page)
    await expect(page.getByPlaceholder('you@example.com')).toHaveCount(0)
  })
})

test.describe('sign-in', () => {
  test('email code signs in, wakes the pod, and lands on the app', async ({ page }) => {
    await installBridge(page)
    await page.goto('/')

    await page.getByPlaceholder('you@example.com').fill('someone@example.test')
    await page.getByRole('button', { name: /continue with email/i }).click()

    // Step two: the gateway "mailed" a code and the screen switched to the code field.
    const codeField = page.getByPlaceholder('123456')
    await expect(codeField).toBeVisible({ timeout: 15_000 })
    await codeField.fill(DEV_CODE)
    await page.getByRole('button', { name: /sign in|continue/i }).first().click()

    // The login screen is gone and the session is real — `accessToken` is the stub's, NOT "demo".
    await expect(page.getByPlaceholder('123456')).toHaveCount(0, { timeout: 20_000 })
    const session = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem('lmthing_session') ?? 'null'),
    )
    expect(session?.accessToken).toBe('e2e-access-token')
    expect(session?.email).toBe('someone@example.test')

    // And the boot sequence actually ran against the gateway and the pod.
    //
    // POLLED, not sampled. The login screen disappears the moment the session lands, which is
    // BEFORE `waitForPodEdge` has made its first `/api/sessions` poll — so reading the call log
    // once, right here, is a race that passes or fails on scheduling. It failed only under the
    // full suite, which is the worst way for a race to announce itself.
    await expect
      .poll(async () => (await calls(page)).map((c) => c.path), { timeout: 15_000 })
      .toEqual(
        expect.arrayContaining([
          '/api/auth/email/start',
          '/api/auth/email/verify',
          '/api/compute/ensure',
          '/api/sessions',
        ]),
      )
  })

  test('a wrong code is refused and the app stays signed out', async ({ page }) => {
    await installBridge(page)
    await page.goto('/')
    await page.getByPlaceholder('you@example.com').fill('someone@example.test')
    await page.getByRole('button', { name: /continue with email/i }).click()
    await page.getByPlaceholder('123456').fill('000000')
    await page.getByRole('button', { name: /sign in|continue/i }).first().click()

    await expect(page.getByText(/did not work/i)).toBeVisible({ timeout: 15_000 })
    const session = await page.evaluate(() => window.localStorage.getItem('lmthing_session'))
    expect(session).toBeNull()
  })
})

test.describe('the bridge seam', () => {
  /**
   * The whole reason the harness runs the API on a second port.
   *
   * Every request below had to be rewritten from a relative path onto the bridge's absolute
   * origin. If `apiBase()`/`cloudBase` regressed, these would have gone to the static server and
   * 404'd — so this asserts the seam by observing the network, not the screen.
   */
  test('every call is addressed to the injected origin, not the page origin', async ({ page }) => {
    await installBridge(page)
    await page.goto('/')
    await page.getByPlaceholder('you@example.com').fill('someone@example.test')
    await page.getByRole('button', { name: /continue with email/i }).click()
    await expect(page.getByPlaceholder('123456')).toBeVisible({ timeout: 15_000 })

    const log = await calls(page)
    expect(log.length).toBeGreaterThan(0)
    // `/api/auth/email/start` reaching the stub at all is the proof: it is built from
    // `config.cloudUrl`, which without the bridge resolves to production.
    expect(log.map((c) => c.path)).toContain('/api/auth/email/start')
  })

  test('AuthProvider takes its gateway from the bridge, not the production fallback', async ({ page }) => {
    // A regression here does not fail visibly — it signs the person in against the WRONG
    // environment, which is why it is asserted on the wire rather than on screen.
    let productionCalls = 0
    await page.route('https://lmthing.cloud/**', (route) => {
      productionCalls++
      return route.abort()
    })
    await page.route('https://lmthing.com/**', (route) => {
      productionCalls++
      return route.abort()
    })

    await installBridge(page)
    await page.goto('/')
    await page.getByPlaceholder('you@example.com').fill('someone@example.test')
    await page.getByRole('button', { name: /continue with email/i }).click()
    await expect(page.getByPlaceholder('123456')).toBeVisible({ timeout: 15_000 })

    expect(productionCalls).toBe(0)
  })
})

test.describe('the signed-in app', () => {
  /** Sign in and wait until the shell is past the pod-boot gate. */
  async function signIn(page: Page) {
    await installBridge(page)
    await page.goto('/')
    await page.getByPlaceholder('you@example.com').fill('someone@example.test')
    await page.getByRole('button', { name: /continue with email/i }).click()
    await page.getByPlaceholder('123456').fill(DEV_CODE)
    await page.getByRole('button', { name: /sign in|continue/i }).first().click()
    // "Starting your workspace…" is the pod-boot gate; it must clear on its own.
    await expect(page.getByText(/starting your workspace/i)).toHaveCount(0, { timeout: 25_000 })
  }

  test('lands on the Home dashboard, which fetched from the POD and the GATEWAY', async ({ page }) => {
    await signIn(page)

    // The greeting is `DashboardHome`'s first element — the shared surface really mounted, rather
    // than the gate merely having stopped rendering.
    await expect(page.getByText(/good (morning|afternoon|evening)/i)).toBeVisible({ timeout: 20_000 })

    // Both data planes were reached, each through its own seam: projects via `apiUrl` (the pod)
    // and teams via `dataPlaneOrigin('cloud')` (the gateway). A regression in either seam shows up
    // here as a missing path rather than as an empty list nobody notices.
    //
    // Polled rather than snapshotted: the greeting paints before `useDashboardData` resolves, so
    // reading the log once at that moment is a race that passes or fails on scheduling.
    await expect
      .poll(async () => (await calls(page)).map((c) => c.path), { timeout: 20_000 })
      .toEqual(expect.arrayContaining(['/api/projects', '/api/teams']))
  })

  test('the drawer switches surfaces without unmounting the others', async ({ page }) => {
    await signIn(page)
    await expect(page.getByText(/good (morning|afternoon|evening)/i)).toBeVisible({ timeout: 20_000 })

    await page.getByRole('button', { name: 'Open navigation' }).click()
    await page.getByRole('button', { name: /^chat$/i }).first().click()

    // Home is HIDDEN, not gone. `HomeShell` mounts all three surfaces and toggles `display`,
    // because `ChatShell` holds a live pod socket and a transcript that unmounting would drop
    // mid-turn. Asserting "hidden" rather than "absent" is asserting that contract.
    const greeting = page.getByText(/good (morning|afternoon|evening)/i)
    await expect(greeting).toBeHidden({ timeout: 10_000 })
    await expect(greeting).toHaveCount(1)
  })

  test('sign out returns to the login screen', async ({ page }) => {
    await signIn(page)
    await expect(page.getByText(/good (morning|afternoon|evening)/i)).toBeVisible({ timeout: 20_000 })

    await page.getByRole('button', { name: 'Open navigation' }).click()
    await page.getByRole('button', { name: 'Sign out' }).click()

    await expect(page.getByPlaceholder('you@example.com')).toBeVisible({ timeout: 15_000 })
    const session = await page.evaluate(() => window.localStorage.getItem('lmthing_session'))
    expect(session).toBeNull()
  })
})

test.describe('the host bridge', () => {
  /**
   * A genuine protocol round trip: the page dials the pod, pushes its grant list, receives an
   * `fs.request`, routes it through the (stubbed) Tauri command, and answers.
   *
   * Tauri's `invoke` does not exist in Chromium, so it is stubbed at `__TAURI_INTERNALS__` — the
   * layer Tauri's own JS calls through. What is NOT stubbed is anything that matters here: the
   * socket, the framing, the grant push, the correlation id and the reply are all the real
   * `DesktopHostBridge`. The Rust it stands in for has its own 30 tests, `grants.rs` foremost.
   */
  async function installTauriStub(page: Page) {
    await page.addInitScript(() => {
      const grants = [{ id: 'root-1', label: 'code', mode: 'rw' }]
      const calls: Array<{ cmd: string; args: unknown }> = []
      ;(window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {
        invoke: (cmd: string, args: unknown) => {
          calls.push({ cmd, args })
          if (cmd === 'grant_list') return Promise.resolve(grants)
          if (cmd === 'grant_list_detailed') return Promise.resolve([])
          if (cmd === 'fs_op') {
            return Promise.resolve({ ok: true, entries: [{ path: 'README.md', kind: 'file', size: 5 }], truncated: false })
          }
          return Promise.resolve(null)
        },
      }
      ;(window as unknown as Record<string, unknown>)['__tauriCalls'] = calls
    })
  }

  test('dials the pod, pushes grants, and answers a filesystem request', async ({ page }) => {
    await installTauriStub(page)
    await installBridge(page)
    await page.goto('/')

    // Sign in, then open the pane. The bridge dials on its own as soon as HomeShell mounts
    // (`bridge.start({ implied: true })` — see HomeShell.tsx): signing in IS the deliberate act,
    // not opening this panel, so there is no separate "Connect" click to make here.
    await page.getByPlaceholder('you@example.com').fill('someone@example.test')
    await page.getByRole('button', { name: /continue with email/i }).click()
    await page.getByPlaceholder('123456').fill(DEV_CODE)
    await page.getByRole('button', { name: /sign in|continue/i }).first().click()
    await expect(page.getByText(/good (morning|afternoon|evening)/i)).toBeVisible({ timeout: 20_000 })

    await page.getByRole('button', { name: 'Open navigation' }).click()
    await page.getByRole('button', { name: 'Local access' }).click()
    await expect(page.getByText(/Connected — your workspace/i)).toBeVisible({ timeout: 15_000 })

    // The pod saw the grant list — ids and labels only, never a path.
    await expect
      .poll(async () => (await page.request.get(`${STUB}/__bridge`)).json().then((b) => b.grants), {
        timeout: 15_000,
      })
      .toEqual([{ id: 'root-1', label: 'code', mode: 'rw' }])

    // …and got its `fs.request` answered, correlated by id.
    await expect
      .poll(async () => (await page.request.get(`${STUB}/__bridge`)).json().then((b) => b.results), {
        timeout: 15_000,
      })
      .toEqual([
        expect.objectContaining({
          type: 'result',
          id: 'req-1',
          ok: true,
          value: expect.objectContaining({ ok: true }),
        }),
      ])

    // The operation is on screen. Without the activity log the honest answer to "what did it
    // read?" is "no idea", which is not acceptable for a feature that reads someone's disk.
    await expect(page.getByText('tree').first()).toBeVisible({ timeout: 10_000 })
  })

  test('disconnect is instant, and the pane says so', async ({ page }) => {
    await installTauriStub(page)
    await installBridge(page)
    await page.goto('/')
    await page.getByPlaceholder('you@example.com').fill('someone@example.test')
    await page.getByRole('button', { name: /continue with email/i }).click()
    await page.getByPlaceholder('123456').fill(DEV_CODE)
    await page.getByRole('button', { name: /sign in|continue/i }).first().click()
    await expect(page.getByText(/good (morning|afternoon|evening)/i)).toBeVisible({ timeout: 20_000 })
    await page.getByRole('button', { name: 'Open navigation' }).click()
    await page.getByRole('button', { name: 'Local access' }).click()
    // The bridge is already dialing on its own by the time this panel opens (implied start on
    // sign-in) — no "Connect" click needed to reach this state.
    await expect(page.getByText(/Connected — your workspace/i)).toBeVisible({ timeout: 15_000 })

    await page.getByRole('button', { name: 'Disconnect' }).click()
    await expect(page.getByText(/cannot reach this computer/i)).toBeVisible({ timeout: 10_000 })
  })
})
