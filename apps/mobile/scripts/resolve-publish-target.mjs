#!/usr/bin/env node
// Decide whether an automatic publish should happen at all, and print the runtimeVersion
// it would be aimed at.
//
// An OTA can only replace JavaScript. When a commit changes the native project — a new
// Expo module, an SDK bump, a permission, `eas.json`, or an env var `app.config.js` reads
// — the fingerprint moves, and an update published under the new runtimeVersion is one
// that no installed binary can ask for. Nothing about that failure is loud: eoas succeeds,
// the server stores the update, and every phone keeps running what it already had.
//
// So the question is not "did the bundle change" but "does a binary exist that could
// receive this", and `shipped-runtime-versions.json` is the only record of that.
//
// Writes `publish=true|false`, `runtimeVersion=…` and `reason=…` to $GITHUB_OUTPUT when
// it is set, and prints a human summary either way. Exit code is 0 for both answers —
// "this needs a store release" is a normal state of main, not a build failure.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SHIPPED = path.join(APP_DIR, 'shipped-runtime-versions.json')
const platform = process.env.PLATFORM ?? 'android'

// `--workflow managed`: a working copy may hold a gitignored `android/` from a local
// prebuild, and hashing it yields a runtimeVersion no EAS build ever had.
const runtimeVersion = JSON.parse(
  execFileSync(
    'node',
    ['./node_modules/expo-updates/bin/cli.js', 'runtimeversion:resolve', '--platform', platform, '--workflow', 'managed'],
    { cwd: APP_DIR, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: process.env },
  ),
).runtimeVersion

const shipped = JSON.parse(fs.readFileSync(SHIPPED, 'utf8'))[platform] ?? []
const match = shipped.find((b) => b.runtimeVersion === runtimeVersion)

const out = []
out.push(`platform        ${platform}`)
out.push(`runtimeVersion  ${runtimeVersion}`)
out.push(`shipped builds  ${shipped.length ? shipped.map((b) => `${b.runtimeVersion.slice(0, 12)}… (vc${b.versionCode})`).join(', ') : '(none recorded)'}`)

let reason
if (match) {
  reason = `matches shipped build vc${match.versionCode} — an update here reaches it`
  out.push(`\n✔ PUBLISH — ${reason}`)
} else {
  reason =
    'the native project changed, so this runtimeVersion belongs to no shipped binary. ' +
    'An OTA cannot carry it: build and upload a new store release, then add its ' +
    'runtimeVersion to apps/mobile/shipped-runtime-versions.json.'
  out.push(`\n• SKIP — ${reason}`)
}
console.log(out.join('\n'))

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `publish=${match ? 'true' : 'false'}\nruntimeVersion=${runtimeVersion}\nreason=${reason}\n`,
  )
}
