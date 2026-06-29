import { defineConfig } from 'vite-plus'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import path from 'path'
import { fileURLToPath } from 'url'
import { copyFileSync, createReadStream, existsSync, readdirSync, readFileSync } from 'fs'

const __utilsDir = path.dirname(fileURLToPath(import.meta.url))

/**
 * Locate the `sdk/org` root — the directory holding `libs/` (the shared
 * @lmthing/{ui,css,state,auth,utils} packages) and `packages/ui` (agent-ui).
 * The shared libs live INSIDE the sdk/org submodule so the compute pod image
 * (Docker build context = sdk/org) can build the apps self-contained.
 *
 * Two checkout layouts must both resolve:
 *  - Submodule-only (compute image): startDir is under sdk/org, which itself
 *    contains `libs/ui` + `packages/ui` → that ancestor is the org root.
 *  - Full monorepo: the parent root contains `sdk/org/libs/ui`; apps may sit at
 *    the parent root (com/…) or under sdk/org (packages/ui/apps/…). Either way
 *    we either walk up INTO sdk/org or detect it as a `sdk/org` child.
 * @param {string} startDir
 * @returns {string}
 */
function findOrgRoot(startDir) {
  let dir = path.resolve(startDir)
  while (true) {
    if (existsSync(path.join(dir, 'libs', 'ui')) && existsSync(path.join(dir, 'packages', 'ui'))) return dir
    if (existsSync(path.join(dir, 'sdk', 'org', 'libs', 'ui'))) return path.join(dir, 'sdk', 'org')
    const parent = path.dirname(dir)
    if (parent === dir) throw new Error(`Could not locate sdk/org root (libs/ + packages/ui) starting from ${startDir}`)
    dir = parent
  }
}


const FAVICON_MIME = {
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
}

function sharedFaviconPlugin(faviconDir) {
  return {
    name: 'shared-favicon',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/favicon.ico/')) return next()
        const file = req.url.slice('/favicon.ico/'.length).split('?')[0]
        const filePath = path.join(faviconDir, file)
        if (!existsSync(filePath)) return next()
        const ext = path.extname(file)
        res.setHeader('Content-Type', FAVICON_MIME[ext] ?? 'application/octet-stream')
        createReadStream(filePath).pipe(res)
      })
    },
    generateBundle() {
      for (const file of readdirSync(faviconDir)) {
        this.emitFile({
          type: 'asset',
          fileName: `favicon.ico/${file}`,
          source: readFileSync(path.join(faviconDir, file)),
        })
      }
    },
  }
}
const emptyStub = path.resolve(__utilsDir, 'stubs/empty.ts')
const aiSdkStub = path.resolve(__utilsDir, 'stubs/ai-sdk-provider.ts')

function ghPages404Plugin() {
  let outDir
  return {
    name: 'gh-pages-404',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      const indexPath = path.join(outDir, 'index.html')
      const notFoundPath = path.join(outDir, '404.html')
      if (existsSync(indexPath)) {
        copyFileSync(indexPath, notFoundPath)
      }
    },
  }
}

/**
 * @param {string} dirname
 * @param {import('vite-plus').UserConfig} [overrides]
 */
export function createViteConfig(dirname, overrides) {
  const orgRoot = findOrgRoot(dirname)
  const libsDir = path.resolve(orgRoot, 'libs')
  const faviconDir = path.resolve(orgRoot, 'common/favicon.ico')

  return defineConfig({
    plugins: [
      ghPages404Plugin(),
      sharedFaviconPlugin(faviconDir),
      tanstackRouter({
        routesDirectory: './src/routes',
        generatedRouteTree: './src/routeTree.gen.ts',
      }),
      react(),
      tailwindcss(),
      {
        name: 'resolve-workspace-deps',
        enforce: 'pre',
        async resolveId(source, importer, options) {
          if (!importer || source.startsWith('.') || source.startsWith('/') || source.startsWith('@lmthing/') || source.startsWith('@/')) return null
          if (!importer.startsWith(libsDir)) return null
          const resolved = await this.resolve(source, path.resolve(dirname, 'src/main.tsx'), { ...options, skipSelf: true })
          return resolved
        },
      },
      ...(overrides?.plugins ?? []),
    ],
    resolve: {
      // Collapse every React import to a single copy. Workspace libs aliased to
      // source (notably @lmthing/agent-ui, which lives in the sdk/org submodule
      // with its OWN node_modules/react@18) would otherwise pull a second React
      // instance, breaking hooks ("Cannot read properties of null (reading
      // 'useState')") when their components render inside the app's React tree.
      dedupe: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
      alias: {
        '@': path.resolve(dirname, './src'),
        '@lmthing/ui': path.resolve(orgRoot, 'libs/ui/src'),
        // @lmthing/agent-ui ships no committed dist; alias to source so SPA
        // builds resolve it without a prior package build (e.g. studio's
        // agent test-chat route).
        '@lmthing/agent-ui': path.resolve(orgRoot, 'packages/ui/src'),
        '@lmthing/css': path.resolve(orgRoot, 'libs/css/src'),
        '@lmthing/state': path.resolve(orgRoot, 'libs/state/src'),
        '@lmthing/auth': path.resolve(orgRoot, 'libs/auth/src'),

        'vm2': emptyStub,
        'coffee-script': emptyStub,
        '@ai-sdk/anthropic': aiSdkStub,
        '@ai-sdk/openai': aiSdkStub,
        '@ai-sdk/google': aiSdkStub,
        '@ai-sdk/mistral': aiSdkStub,
        '@ai-sdk/azure': aiSdkStub,
        '@ai-sdk/groq': aiSdkStub,
        '@ai-sdk/cohere': aiSdkStub,
        '@ai-sdk/amazon-bedrock': aiSdkStub,
        '@ai-sdk/openai-compatible': aiSdkStub,
        ...overrides?.resolve?.alias,
      },
    },
    server: {
      allowedHosts: ['.test'],
      ...overrides?.server,
    },
    define: {
      'process.env': '{}',
      ...overrides?.define,
    },
  })
}

// retrigger: root lockfile sync
