import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

// Library build for PUBLISHING @nynxz/zenkit-theme — same shape as client/ui/nodekit.
export default defineConfig({
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      // types only today, but never bundle a sibling package
      external: ['@nynxz/zenkit-client'],
    },
  },
})
