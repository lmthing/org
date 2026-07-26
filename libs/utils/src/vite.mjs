import { defineConfig } from 'vite-plus'
import react from '@vitejs/plugin-react'
import { tamaguiPlugin } from '@tamagui/vite-plugin'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import path from 'path'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { copyFileSync, createReadStream, existsSync, readdirSync, readFileSync } from 'fs'

const __utilsDir = path.dirname(fileURLToPath(import.meta.url))
const __require = createRequire(import.meta.url)

/**
 * Load `@tailwindcss/vite` ONLY when a caller keeps Tailwind.
 *
 * It is a peerDependency, so at module scope its import had to resolve from every caller — which is
 * why `apps/web` carried the package as a devDependency long after phase 4 left it with nothing to
 * compile. Requiring it inside the branch makes the peer genuinely optional: the seven product SPAs
 * that still use Tailwind supply it, and a migrated app does not need it on disk at all.
 */
function loadTailwindPlugin() {
  try {
    const mod = __require('@tailwindcss/vite')
    return mod.default ?? mod
  } catch (error) {
    throw new Error(
      'createViteConfig({ tailwind: true }) needs the `@tailwindcss/vite` peer dependency ' +
        'installed in this app. Pass `{ tailwind: false }` if the app has no Tailwind directives ' +
        `left (see sdk/org's apps/web). Original error: ${error.message}`,
    )
  }
}

/**
 * Locate the `sdk/org` root — the directory holding `libs/` (the shared
 * @lmthing/{ui,css,state,auth,utils} packages) and `libs/ui` (agent-ui).
 * The shared libs live INSIDE the sdk/org submodule so the compute pod image
 * (Docker build context = sdk/org) can build the apps self-contained.
 *
 * Two checkout layouts must both resolve:
 *  - Submodule-only (compute image): startDir is under sdk/org, which itself
 *    contains `libs/ui` + `libs/ui` → that ancestor is the org root.
 *  - Full monorepo: the parent root contains `sdk/org/libs/ui`; apps may sit at
 *    the parent root (com/…) or under sdk/org (libs/ui/apps/…). Either way
 *    we either walk up INTO sdk/org or detect it as a `sdk/org` child.
 * @param {string} startDir
 * @returns {string}
 */
function findOrgRoot(startDir) {
  let dir = path.resolve(startDir)
  while (true) {
    if (existsSync(path.join(dir, 'libs', 'ui')) && existsSync(path.join(dir, 'apps'))) return dir
    if (existsSync(path.join(dir, 'sdk', 'org', 'libs', 'ui'))) return path.join(dir, 'sdk', 'org')
    const parent = path.dirname(dir)
    if (parent === dir) throw new Error(`Could not locate sdk/org root (libs/ + apps/) starting from ${startDir}`)
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
/**
 * @param dirname  the app's own directory
 * @param overrides  merged into the returned config
 * @param opts.tailwind  keep the Tailwind v4 vite plugin. DEFAULT TRUE, and that default matters:
 *   the seven product SPAs (`com`/`social`/`team`/`store`/`space`/`blog`/`casa`) all call this factory
 *   and all still use Tailwind — `@apply` in their own `src/index.css` plus hundreds of utility
 *   classNames. Only `sdk/org`'s own `apps/web` was migrated off it (phase 4 of
 *   docs/tamagui-final-steps.md), so `apps/web` opts OUT explicitly and everything else is unaffected.
 *   The plugin is loaded lazily (see {@link loadTailwindPlugin}), so opting out also means the app
 *   does not need the peer dependency installed.
 */
export function createViteConfig(dirname, overrides, opts = {}) {
  const { tailwind = true } = opts
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
      // Tailwind, unless the caller opted out. `sdk/org`'s `apps/web` has no Tailwind directive left
      // after phase 4, so the plugin there is dead weight; the product SPAs are NOT migrated and would
      // render unstyled without it.
      ...(tailwind ? [loadTailwindPlugin()()] : []),
      // Tamagui plugin (§6 build integration). Loads the SHARED config so the RNW aliases + theme
      // are wired. No-op on output until a web component uses Tamagui.
      tamaguiPlugin({
        // NOTE: the plugin bundles this config to `<app>/.tamagui/tamagui.config.mjs` and then
        // IMPORTS that file from the app root, leaving `@tamagui/web` external. Once the config
        // gained an animation driver that import became load-bearing, so `@tamagui/web` is a
        // devDependency of `apps/web` purely to make the bundled config resolvable — without it
        // every build logs "No bundled config generated" 227 times (harmless with extraction off,
        // but it buries real output).
        config: path.resolve(orgRoot, 'libs/ui/src/theme/tamagui.config.ts'),
        // `@tamagui/core` (not the `tamagui` kit, which isn't installed) is the component source the
        // extractor bundles; `@lmthing/ui` can't be listed here — config-bundling the whole package
        // pulls in app-only deps (@tanstack/react-query, @/…) that don't resolve. Surfaces import
        // Row/Col/Box from `@lmthing/ui`, which the extractor won't statically optimize; those fall
        // back to Tamagui's runtime, which injects the same `:root`-boosted unlayered CSS the
        // compiler would (B0) — web correctness is identical, extraction is just a perf win.
        components: ['@tamagui/core'],
        /*
         * Extraction OFF — re-measured in phase 5c of docs/tamagui-final-steps.md, after the two
         * Tamagui configs merged, because the plan said to measure rather than assume.
         *
         * The measurement: flipping this to `false` (extraction ON) is a NO-OP. Two builds each way
         * produced BYTE-IDENTICAL output — same `index-*.css` and `index-*.js` content hashes — and
         * the same wall clock (4.3–4.5 s off, 4.4–4.6 s on, i.e. inside the noise).
         *
         * So the reason to leave it off is not the one previously written here. The old comment
         * claimed the per-file worker "~3×'d the build"; that is no longer reproducible under
         * vite 8 / rolldown and would have been a misleading thing to act on. The real reason is
         * scope: the components the surfaces actually render come from `@lmthing/ui`, which cannot be
         * listed in `components` above (config-bundling the whole package pulls in app-only deps that
         * do not resolve), so the extractor has nothing in range to optimise and produces the same
         * output either way. Runtime Tamagui remains correctness-equivalent (B0).
         *
         * Worth revisiting only if `@lmthing/ui` becomes config-bundleable; until then the flag's
         * value is cosmetic and `true` is the honest default.
         */
        disableExtraction: true,
      }),
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
      // source (e.g. @lmthing/ui/chat) would otherwise pull a second React
      // instance from their own node_modules, breaking hooks ("Cannot read
      // properties of null (reading 'useState')") when their components render
      // inside the app's React
      // instance, breaking hooks ("Cannot read properties of null (reading
      // 'useState')") when their components render inside the app's React tree.
      dedupe: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
      alias: {
        '@': path.resolve(dirname, './src'),
        // Specific subpath must come BEFORE the generic prefix alias.
        '@lmthing/ui/chat/css': path.resolve(orgRoot, 'libs/ui/src/chat/app/styles.css'),
        '@lmthing/ui': path.resolve(orgRoot, 'libs/ui/src'),
        // @lmthing/agent-ui is now a shim for @lmthing/ui/chat; alias to chat source.
        '@lmthing/agent-ui': path.resolve(orgRoot, 'libs/ui/src/chat'),
        // Specific subpath before the generic alias: the package `exports` maps this to a nested
        // file the naive `@lmthing/css` prefix alias can't resolve (bundled once the Tamagui
        // primitives pull in tamagui.config → @lmthing/css/tamagui-tokens).
        '@lmthing/css/tamagui-tokens': path.resolve(orgRoot, 'libs/css/src/tamagui/tokens.generated.ts'),
        '@lmthing/css': path.resolve(orgRoot, 'libs/css/src'),
        '@lmthing/state': path.resolve(orgRoot, 'libs/state/src'),
        '@lmthing/auth': path.resolve(orgRoot, 'libs/auth/src'),
        // Subpath alias must come BEFORE the generic @lmthing/core alias.
        '@lmthing/core/ui': path.resolve(orgRoot, 'libs/core/src/ui/index.ts'),
        '@lmthing/core': path.resolve(orgRoot, 'libs/core/src'),

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
