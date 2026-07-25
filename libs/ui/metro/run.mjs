/**
 * run.mjs — execute a built native bundle and read the results back.
 *
 * The bundle runs in a CHILD Node process, not in this one: it installs React Native's globals
 * (`__DEV__`, `window`, a `jest` shim — see `globals.cjs`) and boots the RN runtime, and neither
 * belongs in the process that also runs the build. A child also means a hard crash inside the
 * bundle is an exit code to report rather than a dead runner.
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const RESULT_TAG = '##METRO-TEST-RESULT##'
const DONE_TAG = '##METRO-TEST-DONE##'

/**
 * @param {string} bundlePath
 * @returns {Promise<{results: {name: string, ok: boolean, error?: string, stack?: string}[],
 *                    done: {total: number, failed: number} | null,
 *                    exitCode: number, output: string}>}
 */
export async function runNativeBundle(bundlePath, { timeoutMs = 120_000 } = {}) {
  const child = spawn(
    process.execPath,
    ['--require', path.join(here, 'globals.cjs'), bundlePath],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )

  let output = ''
  child.stdout.on('data', (chunk) => (output += chunk))
  child.stderr.on('data', (chunk) => (output += chunk))

  const exitCode = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`native bundle did not finish within ${timeoutMs}ms`))
    }, timeoutMs)
    child.on('error', (err) => (clearTimeout(timer), reject(err)))
    child.on('close', (code) => (clearTimeout(timer), resolve(code ?? 0)))
  })

  const results = []
  let done = null
  for (const line of output.split('\n')) {
    if (line.startsWith(RESULT_TAG)) results.push(JSON.parse(line.slice(RESULT_TAG.length)))
    else if (line.startsWith(DONE_TAG)) done = JSON.parse(line.slice(DONE_TAG.length))
  }
  return { results, done, exitCode, output }
}
