#!/usr/bin/env node
/**
 * Build a single-file `lmthing` executable for one target.
 *
 *   node scripts/bundle/build.mjs                     # host target
 *   node scripts/bundle/build.mjs --target linux-arm64
 *   node scripts/bundle/build.mjs --keep-payload      # leave the tree for inspection
 *
 * The result is `dist-bundle/lmthing-<target>`: Node's own binary with a
 * compressed copy of the runtime tree (`payload.mjs`) and the vendored zerostack
 * appended as a `node:sea` asset. `launcher.cjs` unpacks it on first run.
 *
 * Lightpanda is NOT in here. At 156 MB it is larger than everything else
 * combined, and most runs never browse — so it is fetched on first use into the
 * same cache the payload extracts to (`browser/lightpanda-install.ts`). The URL
 * for this target's asset is baked in, so the running binary never guesses.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { CLI_ROOT, buildPayload } from './payload.mjs';
import { resolveTarget } from './targets.mjs';

/**
 * postject is pinned. It rewrites the executable's own section table; an
 * unpinned tool doing that is a supply-chain surface for every artifact we ship.
 */
const POSTJECT = 'postject@1.0.0-alpha.6';
/** Node's fixed SEA fuse — a constant of the runtime, not a choice. */
const SENTINEL = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

const log = (msg) => console.log(msg);
const mb = (bytes) => `${(bytes / 1e6).toFixed(1)} MB`;

const target = resolveTarget(arg('target'));
const outDir = arg('out', join(CLI_ROOT, 'dist-bundle'));
const work = join(outDir, `.work-${target.id}`);
const payloadDir = join(work, 'payload');
const tarball = join(work, 'payload.tar.gz');

if (target.id !== `${process.platform}-${process.arch}`) {
  // The executable is a copy of THIS Node binary, so it can only ever run on
  // this platform. Building "for" another one would produce an artifact that
  // fails at exec with a format error — CI gives each target its own runner.
  console.error(
    `refusing to build ${target.id} on ${process.platform}-${process.arch}:\n` +
      `  a SEA executable is this host's own node binary with a payload appended, so it is not\n` +
      `  cross-buildable. Run this on a ${target.id} runner (see .github/workflows/cli-bundle.yml).`,
  );
  process.exit(1);
}

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

// ── 1. the runtime tree ──────────────────────────────────────────────────────
log(`\n▸ payload for ${target.id}`);
const manifest = buildPayload({ payload: payloadDir, target, log });

// ── 2. compress it ───────────────────────────────────────────────────────────
log('\n▸ compressing payload');
execFileSync('tar', ['-czf', tarball, '-C', payloadDir, '.'], { stdio: 'inherit' });
const payloadBytes = readFileSync(tarball);
log(`[bundle] payload.tar.gz ${mb(payloadBytes.length)}`);

// The cache path IS the content hash, which is what makes a lost extraction race
// harmless (the winner's tree is the same tree) and makes an upgrade land in a
// new directory instead of mutating one a running process is reading from.
const id = createHash('sha256').update(payloadBytes).digest('hex').slice(0, 16);
log(`[bundle] payload id ${id}`);

writeFileSync(
  join(work, 'bundle.json'),
  `${JSON.stringify({ id, ...manifest, deps: undefined }, null, 2)}\n`,
);

// ── 3. the SEA blob ──────────────────────────────────────────────────────────
log('\n▸ generating the SEA blob');
const seaConfig = join(work, 'sea-config.json');
writeFileSync(
  seaConfig,
  `${JSON.stringify(
    {
      main: join(CLI_ROOT, 'scripts', 'bundle', 'launcher.cjs'),
      output: join(work, 'sea-prep.blob'),
      disableExperimentalSEAWarning: true,
      // Off deliberately: the launcher is a few hundred lines and gains nothing
      // measurable, while a code cache in the blob is invalidated by any V8
      // difference and fails in a way that reads like a corrupt executable. The
      // win that matters is `enableCompileCache` over the EXTRACTED TREE, which
      // the launcher turns on at runtime — that is where the megabytes of JS are.
      useCodeCache: false,
      assets: {
        'payload.tar.gz': tarball,
        'bundle.json': join(work, 'bundle.json'),
      },
    },
    null,
    2,
  )}\n`,
);
execFileSync(process.execPath, ['--experimental-sea-config', seaConfig], { stdio: 'inherit' });

// ── 4. inject into a copy of this node ───────────────────────────────────────
log('\n▸ injecting');
mkdirSync(outDir, { recursive: true });
const exe = join(outDir, `lmthing-${target.id}${target.exeSuffix}`);
rmSync(exe, { force: true });
cpSync(process.execPath, exe);
chmodSync(exe, 0o755);

if (process.platform === 'win32') {
  // The runner's node.exe is Authenticode-signed, and appending a blob invalidates
  // that signature. Stripping it first means the artifact is honestly UNSIGNED
  // rather than carrying a broken signature, which some tooling treats as
  // tampering rather than as absence. Best effort: signtool is not on every
  // runner image, and its absence must not fail the build.
  try {
    execFileSync('signtool', ['remove', '/s', exe], { stdio: 'inherit' });
  } catch {
    log('[bundle] signtool unavailable — the copied node signature stays invalid (artifact is unsigned either way)');
  }
}

const postjectArgs = [
  '-y',
  POSTJECT,
  exe,
  'NODE_SEA_BLOB',
  join(work, 'sea-prep.blob'),
  '--sentinel-fuse',
  SENTINEL,
];
if (process.platform === 'darwin') {
  // Mach-O keeps SEA data in its own segment, and the binary must be unsigned
  // while it is rewritten — postject invalidates the existing signature, and a
  // binary with a stale signature is refused by Gatekeeper with a message about
  // damage rather than about signing.
  postjectArgs.push('--macho-segment-name', 'NODE_SEA');
  execFileSync('codesign', ['--remove-signature', exe], { stdio: 'inherit' });
}
// `shell` on Windows for the same reason as npm in payload.mjs: `npx` is a .cmd shim.
execFileSync('npx', postjectArgs, { stdio: 'inherit', shell: process.platform === 'win32' });
if (process.platform === 'darwin') {
  // Ad-hoc signature. Not notarisation — these artifacts are unsigned in the
  // same sense the desktop bundles are — but without SOME valid signature an
  // arm64 macOS binary will not execute at all.
  execFileSync('codesign', ['--sign', '-', exe], { stdio: 'inherit' });
}

if (!has('keep-payload')) rmSync(work, { recursive: true, force: true });

log(`\n✓ ${exe}  ${mb(statSync(exe).size)}`);
log(
  `  target ${target.id} · payload ${id} · ` +
    `zerostack ${manifest.zerostack ? 'embedded' : 'UNAVAILABLE (no upstream build)'} · ` +
    `lightpanda ${target.platform === 'win32' ? 'UNAVAILABLE (no upstream build)' : 'fetched on first browse'}`,
);
