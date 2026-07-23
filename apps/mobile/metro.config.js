// Metro config for the Expo mobile shell.
//
// The shared libs (@lmthing/ui, @lmthing/css, @lmthing/state) live OUTSIDE this app (it is
// excluded from the pnpm workspace), so Metro must watch the repo root and resolve their source.
// Metro automatically prefers `*.native.tsx` over `*.tsx`, which is what makes the primitives'
// native forks the mobile render target while web keeps `index.tsx`.
const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const projectRoot = __dirname
const repoRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

// Watch the shared libs' source.
config.watchFolders = [repoRoot]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(repoRoot, 'node_modules'),
]
config.resolver.disableHierarchicalLookup = false

module.exports = config
