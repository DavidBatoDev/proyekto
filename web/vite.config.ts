import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

import { tanstackRouter } from '@tanstack/router-plugin/vite'
import { fileURLToPath, URL } from 'node:url'

const DEVELOPMENT_SUPABASE_REF = 'vyiedlwasdwmjbztqznl'

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? env.VITE_SUPABASE_URL
  const allowProdInDev =
    (process.env.VITE_ALLOW_PROD_SUPABASE_IN_DEV ?? env.VITE_ALLOW_PROD_SUPABASE_IN_DEV) ===
    'true'
  if (
    command === 'serve' &&
    mode === 'development' &&
    !supabaseUrl?.includes(DEVELOPMENT_SUPABASE_REF) &&
    !allowProdInDev
  ) {
    throw new Error(
      `Development must use Supabase project ${DEVELOPMENT_SUPABASE_REF}. ` +
        'Copy .env.development.example to .env.development.local and add the dev anon key. ' +
        'To intentionally point local dev at another project, set VITE_ALLOW_PROD_SUPABASE_IN_DEV=true ' +
        'in your local (gitignored) .env.development.local — do not commit that override.',
    )
  }
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
        // Co-located tests live beside the routes they cover; without this the
        // generator warns that they "contain no route piece" and tries to
        // treat them as routes.
        routeFileIgnorePattern: 'workItemsOptimistic\\.ts$|\\.test\\.tsx?$',
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
