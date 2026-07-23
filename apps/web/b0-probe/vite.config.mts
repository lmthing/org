import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tamaguiPlugin } from '/home/user/org/libs/utils/node_modules/@tamagui/vite-plugin/dist/esm/index.mjs'
import path from 'node:path'

const here = path.dirname(new URL(import.meta.url).pathname)

export default defineConfig({
  root: here,
  plugins: [
    react(),
    tailwindcss(),
    tamaguiPlugin({
      config: path.join(here, 'tamagui.config.ts'),
      components: ['@tamagui/core'],
      // extraction ON (the optimizing compiler) — this is the pivotal condition.
      disableExtraction: false,
    }) as any,
  ],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@tamagui/core': '/home/user/org/libs/ui/node_modules/@tamagui/core',
    },
  },
  build: {
    outDir: path.join(here, 'dist'),
    emptyOutDir: true,
    minify: false,
  },
})
