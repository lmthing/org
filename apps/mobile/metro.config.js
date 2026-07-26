// Metro config for the mobile app.
//
// `apps/mobile` is IN the pnpm workspace, so the shared libs resolve through the normal symlink
// layout — the same shape `libs/ui/metro` proves. Metro still has to watch the repo root, because
// the libs are consumed as SOURCE (they have no build step for native) and live outside this
// directory.
//
// Metro's `*.native.tsx` preference is what selects the primitives' native forks. It is never
// overridden here: that preference is the load-bearing assumption of the whole native target, and
// `libs/ui/metro/graph-gate.mjs` asserts it holds.
const { getDefaultConfig } = require('expo/metro-config')
const path = require('node:path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

config.watchFolders = [workspaceRoot]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]

module.exports = config
