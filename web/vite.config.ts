import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

import { tanstackRouter } from '@tanstack/router-plugin/vite'
import { fileURLToPath, URL } from 'node:url'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
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
      devtools(),
      tanstackRouter({
        target: 'react',
        autoCodeSplitting: true,
      }),
      viteReact(),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    test: {
      exclude: ['playwright/**', 'node_modules/**', 'dist/**'],
    },
  }
})
