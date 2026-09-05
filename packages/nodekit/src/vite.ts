import { fileURLToPath, URL } from 'node:url'
import { defineConfig, type Plugin, type UserConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// The Vite build every ComfyUI node pack needs, in one call. Imported as
// `@nynxz/zenkit-nodekit/vite` — Node-side only, so a pack's bundle never sees vite.

// ComfyUI's frontend runtime modules are provided by the host page: keep them external and
// rewrite the specifier to ComfyUI's served /scripts/*.js at emit time.
const COMFY_RUNTIME: Record<string, string> = {
  '@comfy/app': '../../../scripts/app.js',
  '@comfy/api': '../../../scripts/api.js',
}

// ComfyUI serves only .js from WEB_DIRECTORY, so fold the CSS into main.js.
// `enforce: 'post'` — at default ordering the CSS asset is not in the bundle yet.
function inlineCss(extensionName: string): Plugin {
  return {
    name: 'zenkit-inline-css',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      let css = ''
      const cssFiles: string[] = []
      for (const [name, asset] of Object.entries(bundle)) {
        if (name.endsWith('.css') && asset.type === 'asset') {
          css += String(asset.source)
          cssFiles.push(name)
        }
      }
      if (!css) return
      const js = bundle['main.js']
      if (!js || js.type !== 'chunk') return
      js.code =
        `(function(){var s=document.createElement('style');` +
        `s.setAttribute('data-extension',${JSON.stringify(extensionName)});` +
        `s.textContent=${JSON.stringify(css)};document.head.appendChild(s);})();` +
        js.code
      for (const f of cssFiles) delete bundle[f]
    },
  }
}

export interface ZenPluginOptions {
  /** The pack's name — also the `data-extension` attribute on the injected style tag. */
  name: string
  /** Always `import.meta.url` from the pack's own vite config, so paths resolve relative to it. */
  configUrl: string
  /** Entry, relative to the config. Defaults to the conventional `./src/main.ts`. */
  entry?: string
  /** Output dir, relative to the config — must match the pack's `WEB_DIRECTORY`. Default `js`. */
  outDir?: string
  /** The pack's frontend source dir, relative to the config. `@` aliases to it. Default `./src`. */
  srcDir?: string
  /** Extra module aliases, merged after `@` (so passing `@` overrides it). */
  alias?: Record<string, string>
}

/** The whole build for a ZenKit ComfyUI plugin: `export default zenPluginConfig({...})`. */
export function zenPluginConfig({
  name,
  configUrl,
  srcDir = './src',
  entry,
  outDir = 'js',
  alias = {},
}: ZenPluginOptions): UserConfig {
  const at = (p: string) => fileURLToPath(new URL(p, configUrl))
  return defineConfig({
    plugins: [vue(), inlineCss(name)],
    resolve: {
      // `@` -> the pack's own src. Extra aliases merge in via `opts.alias` (this repo's
      // plugins use it to resolve @nynxz/zenkit-* to workspace source).
      alias: { '@': at(srcDir), ...alias },
    },
    // Vite does not substitute this in lib mode; Vue's ESM build reads it.
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
      target: 'es2022',
      outDir,
      emptyOutDir: true,
      minify: false, // served locally; keep it readable
      sourcemap: false,
      cssCodeSplit: false,
      assetsInlineLimit: Infinity,
      lib: {
        entry: at(entry ?? `${srcDir}/main.ts`),
        formats: ['es'],
        fileName: () => 'main.js',
      },
      rollupOptions: {
        external: (id) => id in COMFY_RUNTIME,
        output: {
          paths: COMFY_RUNTIME,
          entryFileNames: 'main.js',
          assetFileNames: 'assets/[name].[ext]',
        },
      },
    },
  })
}
