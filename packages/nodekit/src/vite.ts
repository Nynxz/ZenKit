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

// The shared ZenKit runtime: one Vue, one @nynxz/zenkit-ui (with its CSS) and one
// @nynxz/zenkit-client for every Zen plugin on the page, served by ComfyUI-ZenKit at
// /zenkit/runtime/. Every plugin resolves the same URL, so the browser loads each once.
export const ZENKIT_RUNTIME: Record<string, string> = {
  vue: '../../zenkit/runtime/vue.js',
  '@nynxz/zenkit-ui': '../../zenkit/runtime/ui.js',
  '@nynxz/zenkit-client': '../../zenkit/runtime/client.js',
}

// ComfyUI serves only .js from WEB_DIRECTORY, so fold the CSS into the entry chunk.
// `enforce: 'post'` — at default ordering the CSS asset is not in the bundle yet.
function inlineCss(extensionName: string, entry = 'main.js'): Plugin {
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
      const js = bundle[entry]
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
  /**
   * Import vue, @nynxz/zenkit-ui and @nynxz/zenkit-client from the runtime ComfyUI-ZenKit
   * serves instead of bundling them. The pack then requires ComfyUI-ZenKit to be installed.
   */
  sharedRuntime?: boolean
}

/** The whole build for a ZenKit ComfyUI plugin: `export default zenPluginConfig({...})`. */
export function zenPluginConfig({
  name,
  configUrl,
  srcDir = './src',
  entry,
  outDir = 'js',
  alias = {},
  sharedRuntime = false,
}: ZenPluginOptions): UserConfig {
  const at = (p: string) => fileURLToPath(new URL(p, configUrl))
  const runtime = { ...COMFY_RUNTIME, ...(sharedRuntime ? ZENKIT_RUNTIME : {}) }
  return defineConfig({
    plugins: [vue(), inlineCss(name)],
    resolve: {
      // `@` -> the pack's own src. Extra aliases merge in via `opts.alias` (this repo's
      // plugins use it to resolve @nynxz/zenkit-* to workspace source).
      alias: { '@': at(srcDir), ...alias },
      // Vue is bundled, not external, so two copies of it in one bundle is a broken build —
      // components lose reactivity and injections silently miss. That happens the moment a
      // @nynxz/zenkit-* package is consumed through a link rather than from the pack's own
      // node_modules: the linked package resolves `vue` from ITS install, the pack from its
      // own. Force every `vue` import to the pack's copy.
      dedupe: ['vue'],
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
        external: (id) => id in runtime,
        output: {
          paths: runtime,
          entryFileNames: 'main.js',
          assetFileNames: 'assets/[name].[ext]',
        },
      },
    },
  })
}

const RUNTIME_ENTRY = 'zenkit-runtime:'

export interface ZenRuntimeOptions {
  /** Always `import.meta.url` from ComfyUI-ZenKit's runtime vite config. */
  configUrl: string
  /** Aliases resolving @nynxz/zenkit-* to source. */
  alias?: Record<string, string>
  /** Output dir, relative to the config. Served at /zenkit/runtime/. Default `runtime`. */
  outDir?: string
}

/** Builds the modules in ZENKIT_RUNTIME. Vue lands in vue.js and ui.js/client.js import it. */
export function zenRuntimeConfig({ configUrl, alias = {}, outDir = 'runtime' }: ZenRuntimeOptions): UserConfig {
  const entries = Object.fromEntries(
    Object.entries(ZENKIT_RUNTIME).map(([specifier, path]) => [
      path.slice(path.lastIndexOf('/') + 1, -'.js'.length),
      specifier,
    ]),
  )
  return defineConfig({
    plugins: [
      vue(),
      inlineCss('zenkit-runtime', 'ui.js'),
      {
        name: 'zenkit-runtime-entries',
        enforce: 'pre',
        // Vite path-resolves lib entries, so the marker arrives prefixed with the root.
        resolveId: (id) => {
          const at = id.indexOf(RUNTIME_ENTRY)
          return at === -1 ? null : `\0${id.slice(at)}`
        },
        load: (id) =>
          id.startsWith(`\0${RUNTIME_ENTRY}`)
            ? `export * from ${JSON.stringify(id.slice(RUNTIME_ENTRY.length + 1))}`
            : null,
      },
    ],
    resolve: { alias, dedupe: ['vue'] },
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
      target: 'es2022',
      outDir: fileURLToPath(new URL(outDir, configUrl)),
      emptyOutDir: true,
      minify: false,
      sourcemap: false,
      cssCodeSplit: false,
      assetsInlineLimit: Infinity,
      lib: {
        entry: Object.fromEntries(
          Object.entries(entries).map(([name, specifier]) => [name, `${RUNTIME_ENTRY}${specifier}`]),
        ),
        formats: ['es'],
        fileName: (_format, name) => `${name}.js`,
      },
      rollupOptions: {
        external: (id) => id in COMFY_RUNTIME,
        output: {
          paths: COMFY_RUNTIME,
          chunkFileNames: 'chunks/[name]-[hash].js',
          assetFileNames: 'assets/[name].[ext]',
        },
      },
    },
  })
}
