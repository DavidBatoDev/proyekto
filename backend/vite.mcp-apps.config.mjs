import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { viteSingleFile } from 'vite-plugin-singlefile';

const backendDir = dirname(fileURLToPath(import.meta.url));

export default {
  root: resolve(backendDir, 'mcp-apps'),
  base: './',
  plugins: [viteSingleFile()],
  build: {
    outDir: resolve(backendDir, 'dist/mcp-apps'),
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(backendDir, 'mcp-apps/roadmap-summary.html'),
    },
  },
};
