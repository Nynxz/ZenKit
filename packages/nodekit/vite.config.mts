import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// Three entries, deliberately separate:
//   index — the browser runtime a pack bundles into its extension;
//   vite  — the Node-side build preset its vite.config imports;
//   cli   — the `zenkit-nodekit` bin (sync the vendored Python, check the widget contract).
// Keeping them apart means a pack's browser bundle never pulls vite or node: modules in.
export default defineConfig({
  plugins: [vue()],
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    lib: {
      entry: { index: at('./src/index.ts'), vite: at('./src/vite.ts'), cli: at('./cli/main.ts') },
      formats: ['es'],
    },
    rollupOptions: {
      // vue + the host modules are the consumer's; vite/plugin-vue are the consumer's too
      // (they only exist on the Node side, where the pack already has them).
      external: ['vue', '@comfy/app', '@comfy/api', 'vite', '@vitejs/plugin-vue', /^node:/],
      output: {
        entryFileNames: '[name].js',
        banner: (chunk) => (chunk.name === 'cli' ? '#!/usr/bin/env node' : ''),
      },
    },
  },
})
