import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

import { tanstackRouter } from '@tanstack/router-plugin/vite'
import { fileURLToPath, URL } from 'node:url'

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const themeSystemEnabled =
    (process.env.VITE_THEME_SYSTEM_ENABLED ?? env.VITE_THEME_SYSTEM_ENABLED) !== 'false'

  return {
    plugins: [
      {
        name: 'theme-system-build-flag',
        transformIndexHtml(html) {
          return html.replaceAll(
            '__THEME_SYSTEM_ENABLED__',
            themeSystemEnabled ? 'true' : 'false',
          )
        },
      },
      ...(command === 'serve' ? [devtools()] : []),
      tanstackRouter({
        target: 'react',
        autoCodeSplitting: true,
        routeFileIgnorePattern: 'workItemsOptimistic\\.ts$',
      }),
      viteReact(),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    build: {
      // Computing gzip sizes for every generated route chunk adds noticeable
      // time but does not change the build artifacts.
      reportCompressedSize: false,
    },
    test: {
      exclude: ['playwright/**', 'node_modules/**', 'dist/**'],
    },
  }
})
