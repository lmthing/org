import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const org = path.resolve(here, '../../../..')

/**
 * The P0 harness build. Real `theme.css` compiled by `@tailwindcss/vite` (so the PREFLIGHT resets
 * are present, exactly as in production) plus the real `@lmthing/ui` source. Runtime Tamagui — no
 * compiler plugin — which is how `apps/web` ships today (`disableExtraction: true`).
 */
export default defineConfig({
  root: here,
  plugins: [react(), tailwindcss()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@lmthing/css/theme.css': path.join(org, 'libs/css/src/theme.css'),
      '@lmthing/css/tamagui-tokens': path.join(org, 'libs/css/src/tamagui/tokens.generated.ts'),
      '@lmthing/ui': path.join(org, 'libs/ui/src'),
      '@lmthing/css': path.join(org, 'libs/css/src'),
      '@tamagui/core': path.join(org, 'libs/ui/node_modules/@tamagui/core'),
    },
  },
  build: { outDir: path.join(here, 'dist'), emptyOutDir: true, minify: false, sourcemap: true },
})
