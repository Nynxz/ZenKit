import { copyFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'

// Library build for PUBLISHING @nynxz/zenkit-ui. Declarations are emitted separately by
// `vue-tsc -p tsconfig.build.json` (see the build script) rather than vite-plugin-dts,
// which silently skipped every .vue component and left the re-exports in index.d.ts
// pointing at files that were never emitted.
//
// Inside this monorepo the plugins do NOT consume this output — they alias
// '@nynxz/zenkit-ui' straight to src/ so a component edit is picked up without a rebuild.
// This build exists for external consumers (a separate node-pack repo installing the
// package by path during development, or from npm later), which is why `exports`
// points at dist/ while the internal aliases point at src/.
// comfy-bridge.css is not imported by any component (consumers import it themselves), so
// the bundler never sees it. Copy it into dist so `files: ["dist"]` publishes it.
function copyBridgeCss(): Plugin {
  const from = fileURLToPath(new URL('./src/comfy-bridge.css', import.meta.url))
  const to = fileURLToPath(new URL('./dist/comfy-bridge.css', import.meta.url))
  return {
    name: 'zenkit-copy-bridge-css',
    apply: 'build',
    closeBundle() {
      copyFileSync(from, to)
    },
  }
}

export default defineConfig({
  plugins: [vue(), copyBridgeCss()],
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    cssCodeSplit: false,
    sourcemap: true,
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      // Vue is the consumer's (and ComfyUI's) — never bundle a second copy.
      external: ['vue'],
      output: { assetFileNames: 'zenkit-ui.[ext]' },
    },
  },
})
