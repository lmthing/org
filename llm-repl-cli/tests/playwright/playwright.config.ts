import { defineConfig, devices } from '@playwright/test'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const rootDir = resolve(__dirname, '../..')

export default defineConfig({
  testDir: './specs',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 2 : undefined,

  reporter: [
    ['html', { outputFolder: resolve(rootDir, 'test-results/playwright-report'), open: 'never' }],
    ['json', { outputFile: resolve(rootDir, 'test-results/playwright-results.json') }],
    ['line'],
  ],

  use: {
    baseURL: 'http://localhost:3101',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 1280, height: 720 },
  },

  projects: [
    {
      name: 'chrome',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: ['**/llm-judge.spec.ts'],
    },
    {
      name: 'llm-judge',
      use: { ...devices['Desktop Chrome'] },
      testMatch: ['**/llm-judge.spec.ts'],
      timeout: 120_000,
    },
  ],

  webServer: {
    command: `pnpm exec vite --config ${resolve(rootDir, 'vite.config.web.ts')} --port 3101`,
    port: 3101,
    timeout: 60_000,
    reuseExistingServer: !process.env['CI'],
    cwd: rootDir,
    env: {
      // Ensure the app connects to the standard port our WS mock intercepts
      VITE_WS_URL: 'ws://localhost:3010',
    },
  },
})
