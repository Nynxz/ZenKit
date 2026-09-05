# ZenKit

A UX-framework plugin for ComfyUI — floating/snapping/tiling panels, a shared theme token
system, and a cross-plugin event bus, exposed on the page as `window.ZenKit`. Other plugins
build on it; ZenKit itself ships no nodes.

## Repo map (pnpm workspace)

```
packages/
  types    @nynxz/zenkit-types    npm   public contract — types only, no runtime
  client   @nynxz/zenkit-client   npm   consumer SDK — one import, no-ops when ZenKit is absent
  ui       @nynxz/zenkit-ui       npm   shared Vue components (token-driven, runtime-free)
  nodekit  @nynxz/zenkit-nodekit  npm   a node pack's frontend: build, host types, widgets
  theme    @nynxz/zenkit-theme          semantic token packs and the applier
  core     @nynxz/zenkit-core           the runtime: bus, theme, panels, docks, jobs, channels
plugins/
  ComfyUI-ZenKit         the installable host (serves window.ZenKit + the themes)
  ComfyUI-ZenSuite       core panel pack: Media Viewer, Asset Browser, Timer
  ComfyUI-ZenInspector   install-wide debug panel for nodepacks and extensions
```

The four `npm` packages are published so node packs outside this repo can build against them.
`core` and `theme` are the runtime's own internals — only ComfyUI-ZenKit bundles them.
Consumers import types from `client`, never from `types` directly.

Dependencies flow one way: `types ← theme ← core`, `types ← client`, `ui ← core`. `ui` and
`nodekit` are standalone, with `vue` as their only peer. Plugins depend on `client` + `ui`.

## How packages resolve

Vite aliases `@nynxz/zenkit-*` to package **source** (`workspace-aliases.ts`, derived from
`tsconfig.plugin.json`), so editing a component needs no rebuild. TypeScript and npm consumers
instead follow each package's `exports` to built `dist/` — which is why `pnpm check` builds
before it typechecks.

## Dev

```
pnpm install
pnpm check       # build, then lint + format + typecheck across every package
pnpm build       # packages and plugin bundles only
```

Plugins are V3 node packs: `__init__.py` exposes `comfy_entrypoint` and must **not** also
define `NODE_CLASS_MAPPINGS` — ComfyUI checks that first and returns early, so leaving one
behind means `comfy_entrypoint` is never called and nothing registers.
