import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

const here = path.dirname(new URL(import.meta.url).pathname)
const org = '/home/user/org'

/**
 * Surface migration proof build. Real theme.css (compiled by @tailwindcss/vite) + the real
 * @lmthing/ui EmptyState (reference) and the migrated candidate. Runtime Tamagui (no compiler
 * plugin needed — the candidate's Row/Col inject their CSS at runtime).
 */
export default defineConfig({
  root: here,
  plugins: [react(), tailwindcss()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      // Specific subpath before the generic prefix.
      '@lmthing/css/theme.css': path.join(org, 'libs/css/src/theme.css'),
      '@lmthing/css/components/computer/computer-layout.css': path.join(org, 'libs/css/src/components/computer/computer-layout.css'),
      '@lmthing/css/tamagui-tokens': path.join(org, 'libs/css/src/tamagui/tokens.generated.ts'),
      '@lmthing/ui': path.join(org, 'libs/ui/src'),
      '@lmthing/css': path.join(org, 'libs/css/src'),
      '@tamagui/core': path.join(org, 'libs/ui/node_modules/@tamagui/core'),
    },
  },
  build: {
    outDir: path.join(here, 'dist-surface'),
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      input: {
        surface: path.join(here, 'surface.html'),
        'theme-check': path.join(here, 'theme-check.html'),
        'text-probe': path.join(here, 'text-probe.html'),
        'text-variants': path.join(here, 'text-variants.html'),
        'pressable-variants': path.join(here, 'pressable-variants.html'),
        'box-variants': path.join(here, 'box-variants.html'),
        'real-bem': path.join(here, 'real-bem.html'),
      },
    },
  },
})
