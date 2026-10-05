import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

// Library build for PUBLISHING @nynxz/zenkit-client — same shape as ui/nodekit.
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
      // @comfy/app is provided by ComfyUI's page and re-externalised by the consuming
      // pack's build. vue is a peer: bundling it would give the pack a second Vue next to its own.
      external: ['vue', '@comfy/app'],
    },
  },
})
