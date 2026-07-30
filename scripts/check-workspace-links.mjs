#!/usr/bin/env node
/**
 * Does this checkout's `node_modules` belong to THIS workspace?
 *
 * The repo has two pnpm workspaces that both claim the same packages. The root
 * `pnpm-workspace.yaml` lists `sdk/org/libs/*` and `sdk/org/apps/web` (it needs them to build the
 * SPA images); `sdk/org/pnpm-workspace.yaml` lists `libs/*` and `apps/*`. So `sdk/org/libs/ui` is a
 * member of both, and each workspace has its OWN lockfile and its own store. Whichever `pnpm
 * install` ran last owns the symlinks under each member's own `node_modules`.
 *
 * That is survivable while both lockfiles agree, and they do not have to: `libs/ui` asks for
 * `react: ^19.2.0`, a floating range each lockfile resolved at a different time — the root landed
 * on 19.2.4 and sdk/org on 19.2.7. After a root install, `libs/ui/node_modules/react` points into
 * the ROOT store at a version sdk/org's own tree was never built against.
 *
 * The symptoms do not name the cause, which is the whole reason this script exists:
 *
 *   - `pnpm test:native` dies with `Unable to resolve module react from
 *     libs/ui/src/elements/overlays/dialog/index.native.tsx` — pointing at a file that is fine, and
 *     at a package that IS present.
 *   - `@lmthing/mobile#typecheck` fails on a Tamagui config type in `App.tsx`, a line nobody edited.
 *   - `pnpm typecheck` from sdk/org can look GREEN while that happens, because turbo caches the
 *     task until something in `apps/mobile` changes.
 *
 * An hour of hunting, every time, for a one-command fix. So the check is cheap and the message
 * carries the fix. It does NOT try to repair anything: which install is the right one depends on
 * what you are about to do, and guessing would be worse than saying so.
 *
 * Run directly, or as the precondition of `test:native` — the loudest of the three symptoms.
 */
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SDK_ORG = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Packages whose duplication actually breaks a build, rather than every dependency. */
const SINGLETONS = ['react', 'react-dom']

/** The version `sdk/org/pnpm-lock.yaml` settled on, read from the store rather than parsed. */
function storeVersions(pkg) {
  const store = join(SDK_ORG, 'node_modules', '.pnpm')
  if (!existsSync(store)) return []
  return readdirSync(store)
    .filter((d) => d.startsWith(`${pkg}@`) && !d.includes('_'))
    .map((d) => d.slice(pkg.length + 1))
}

const problems = []

for (const member of ['libs/ui', 'libs/core', 'libs/state', 'apps/mobile', 'apps/web']) {
  for (const pkg of SINGLETONS) {
    const link = join(SDK_ORG, member, 'node_modules', pkg)
    if (!existsSync(link)) continue

    const real = realpathSync(link)
    // The store path a link resolves into is the only thing that says WHICH workspace installed it.
    if (!real.startsWith(join(SDK_ORG, 'node_modules'))) {
      const version = JSON.parse(readFileSync(join(real, 'package.json'), 'utf8')).version
      problems.push(
        `${member}/node_modules/${pkg} -> ${real.replace(resolve(SDK_ORG, '..', '..'), '<repo>')} (${version})\n` +
          `      resolves OUTSIDE sdk/org — installed by the ROOT workspace, not this one`,
      )
      continue
    }

    const version = JSON.parse(readFileSync(join(real, 'package.json'), 'utf8')).version
    const known = storeVersions(pkg)
    if (known.length && !known.includes(version)) {
      problems.push(`${member}/node_modules/${pkg} is ${version}, not in sdk/org's store (${known.join(', ')})`)
    }
  }
}

if (problems.length) {
  console.error('\n  sdk/org node_modules were installed by the ROOT workspace.\n')
  for (const p of problems) console.error(`    ✗ ${p}`)
  console.error(
    '\n  Both workspaces claim sdk/org/libs/* — see the comment at the top of this script.\n' +
      '  Fix, from sdk/org:\n\n      pnpm install\n\n' +
      '  Then re-run whatever sent you here. If you need the ROOT workspace instead (building an\n' +
      '  SPA image), install there and expect this check to fail until you install here again.\n',
  )
  process.exit(1)
}

console.log('  ok   node_modules belong to the sdk/org workspace')
