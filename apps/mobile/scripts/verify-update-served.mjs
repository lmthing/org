#!/usr/bin/env node
// Ask the update server for a manifest exactly the way an installed binary does, and
// fail loudly unless it would actually be applied.
//
// This exists because a publish that reaches NOBODY looks identical to a successful one.
// The CLI prints "your update has been successfully pushed" whether or not any device can
// ever receive it, and the two ways that happens are both invisible from the publishing
// side: the channel may have no branch mapping (the server answers every device
// `404 No branch mapping found` while the branch fills up with updates), and the
// runtimeVersion may be one that no binary in the field has (the fingerprint moves when
// `eas.json`, a config plugin or an env var read by `app.config.js` changes).
//
// Run it AFTER publishing, with the same environment the publish ran with, so the
// runtimeVersion it resolves is the one that was published under.
//
// Usage:
//   EXPO_OTA_APP_ID=… [RELEASE_CHANNEL=production] node scripts/verify-update-served.mjs
//
// Optional:
//   EXPECT_UPDATE_ID=…   also assert the served manifest is this exact update
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(HERE, '..')
const CERT = path.join(APP_DIR, 'certs', 'certificate.pem')

const appId = process.env.EXPO_OTA_APP_ID
const channel = process.env.RELEASE_CHANNEL ?? 'production'
if (!appId) fail('EXPO_OTA_APP_ID is unset — the server answers "No app id provided" without it.')

function fail(msg) {
  console.error(`\n✖ ${msg}\n`)
  process.exit(1)
}

// The manifest URL is compiled into the binary, so read it from the same config the
// build reads rather than hardcoding it here — if they ever disagree, this check would
// be verifying a server no device talks to.
const config = JSON.parse(
  execFileSync('npx', ['expo', 'config', '--json', '--type', 'public'], {
    cwd: APP_DIR,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: process.env,
  }),
)
const manifestUrl = config.updates?.url
if (!manifestUrl) fail('No updates.url in the resolved Expo config.')

// `--workflow managed` deliberately: a working copy may hold a gitignored `android/`
// from a local prebuild, and hashing it would produce a runtimeVersion no EAS build has.
//
// RUNTIME_VERSION overrides the resolution entirely. Use it to ask the question that
// actually matters — "can the binary I SHIPPED receive this?" — by passing the
// runtimeVersion EAS recorded for that build (`eas build:list --json`). Resolving from
// the working tree answers a different question, and answers it wrongly the moment the
// tree has moved on since the build.
const runtimeVersion =
  process.env.RUNTIME_VERSION ||
  JSON.parse(
    execFileSync(
      'node',
      ['./node_modules/expo-updates/bin/cli.js', 'runtimeversion:resolve', '--platform', 'android', '--workflow', 'managed'],
      { cwd: APP_DIR, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: process.env },
    ),
  ).runtimeVersion
if (!runtimeVersion) fail('Could not resolve a runtimeVersion.')

console.log(`manifest url    ${manifestUrl}`)
console.log(`app id          ${appId}`)
console.log(`channel         ${channel}`)
console.log(`runtimeVersion  ${runtimeVersion}`)

const res = await fetch(manifestUrl, {
  headers: {
    'expo-app-id': appId,
    'expo-channel-name': channel,
    'expo-runtime-version': runtimeVersion,
    'expo-platform': 'android',
    'expo-protocol-version': '1',
    'expo-api-version': '1',
    'expo-expect-signature': 'true',
    accept: 'multipart/mixed',
  },
})

if (res.status !== 200) {
  const body = (await res.text()).trim()
  const hint =
    body.includes('No branch mapping')
      ? `\n  The channel "${channel}" is not mapped to a branch. Publishing creates the BRANCH;` +
        `\n  the mapping is separate and nothing creates it for you. Create it once with:\n` +
        `\n    POST ${new URL(manifestUrl).origin}/ota/api/apps/${appId}/channels` +
        `\n    {"channelName":"${channel}","branchName":"${channel}"}` +
        `\n\n  (the body key is channelName — "name" answers "Channel name is empty")`
      : body.includes('No app id')
        ? '\n  EXPO_OTA_APP_ID did not reach the server.'
        : ''
  fail(`The server did not serve an update: ${res.status} ${body}${hint}`)
}

const ct = res.headers.get('content-type') ?? ''
const m = /boundary=([^;]+)/.exec(ct)
if (!m) fail(`Expected a multipart/mixed manifest, got content-type: ${ct}`)

// Split by hand so the manifest part keeps its exact bytes — the signature is over
// those, and re-serialising the JSON would invalidate it.
const raw = Buffer.from(await res.arrayBuffer()).toString('binary')
const parts = raw.split('--' + m[1].trim())
const part = parts.find((p) => p.includes('name="manifest"'))

// A 200 is NOT success. When the server has nothing for this runtimeVersion it answers
// 200 with a signed `directive` part instead of a manifest — the same shape, the same
// signature, and no update. That is precisely the "published successfully, reaches
// nobody" case this script exists to catch, so name it rather than dying on a missing
// manifest part.
if (!part) {
  const directive = parts.find((p) => p.includes('name="directive"'))
  const type = directive && /"type"\s*:\s*"([^"]+)"/.exec(directive)?.[1]
  if (type === 'noUpdateAvailable') {
    fail(
      `The server has NO update for runtimeVersion ${runtimeVersion} on channel "${channel}".\n` +
        '  It answered 200 with a signed noUpdateAvailable directive, which is what a device\n' +
        '  sees as "nothing to install" — a publish aimed at a different runtimeVersion looks\n' +
        '  exactly like this from the publishing side.\n\n' +
        '  Usually one of:\n' +
        '    · the publish ran with different env vars than the build (EXPO_OTA_APP_ID,\n' +
        '      RELEASE_CHANNEL are both inside the fingerprint, and so is eas.json)\n' +
        '    · the native project moved since the binaries were built, so this runtimeVersion\n' +
        '      is new and nothing has been published under it yet\n' +
        '    · the update was published to a different branch than this channel maps to',
    )
  }
  if (type === 'rollBackToEmbedded') {
    fail(`The server is directing devices to roll back to their embedded bundle on "${channel}".`)
  }
  fail(`No manifest part in the multipart response${type ? ` (directive: ${type})` : ''}.`)
}
const sep = part.indexOf('\r\n\r\n')
const headerBlock = part.slice(0, sep)
const bodyBuf = Buffer.from(part.slice(sep + 4).replace(/\r\n$/, ''), 'binary')

const sigHeader = /expo-signature:\s*(.+)/i.exec(headerBlock)?.[1]?.trim()
if (!sigHeader) {
  fail(
    'The manifest carries NO expo-signature. The binary embeds a codeSigningCertificate ' +
      'and will refuse this update — the server is not signing for this app.',
  )
}

const sig = Buffer.from(/sig="([^"]+)"/.exec(sigHeader)[1], 'base64')
const pubkey = new crypto.X509Certificate(fs.readFileSync(CERT, 'utf8')).publicKey
if (!crypto.verify('RSA-SHA256', bodyBuf, pubkey, sig)) {
  fail(
    'The manifest signature does NOT verify against certs/certificate.pem — the copy ' +
      'compiled into the binary. Every installed app would reject this update.',
  )
}

const manifest = JSON.parse(bodyBuf.toString('utf8'))
if (manifest.runtimeVersion !== runtimeVersion) {
  fail(`Served runtimeVersion ${manifest.runtimeVersion} != requested ${runtimeVersion}.`)
}
if (process.env.EXPECT_UPDATE_ID && manifest.id !== process.env.EXPECT_UPDATE_ID) {
  fail(`Served update ${manifest.id}, expected ${process.env.EXPECT_UPDATE_ID}.`)
}

// The asset request repeats expo-channel-name on purpose: /assets does the same
// channel→branch lookup as /manifest, so an unmapped channel 404s the bundle even when
// the manifest is fine.
const asset = await fetch(manifest.launchAsset.url, {
  headers: {
    'expo-app-id': appId,
    'expo-channel-name': channel,
    'expo-platform': 'android',
    'expo-protocol-version': '1',
  },
})
if (!asset.ok) fail(`The launch asset is not downloadable: ${asset.status} ${(await asset.text()).slice(0, 120)}`)
const bytes = Buffer.from(await asset.arrayBuffer())
const hash = crypto.createHash('sha256').update(bytes).digest('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
if (hash !== manifest.launchAsset.hash) {
  fail(`Launch asset hash mismatch: got ${hash}, manifest promised ${manifest.launchAsset.hash}.`)
}

console.log(`\n✔ update ${manifest.id} is served, signed, verifiable and downloadable`)
console.log(`  created  ${manifest.createdAt}`)
console.log(`  bundle   ${(bytes.length / 1048576).toFixed(1)} MB`)
