# ZenKit

A UX-framework plugin for ComfyUI — floating/snapping/tiling panels, a shared theme token
system, and a cross-plugin event bus, exposed on the page as `window.ZenKit`. Other plugins
build on it; ZenKit itself ships no nodes.

## Repo map (pnpm workspace)

```
packages/
  types    @nynxz/zenkit-types    the public contract — types only, no runtime
  theme    @nynxz/zenkit-theme    semantic token packs and the applier
  core     @nynxz/zenkit-core     the runtime: bus, theme, panels, docks, jobs, channels
  client   @nynxz/zenkit-client   consumer SDK — one import, no-ops when ZenKit is absent
  ui       @nynxz/zenkit-ui       shared Vue components (token-driven, runtime-free)
  nodekit  @nynxz/zenkit-nodekit  machinery for a node pack's frontend
plugins/
  ComfyUI-ZenKit         the installable host (serves window.ZenKit + the themes)
  ComfyUI-ZenSuite       core panel pack: Media Viewer, Asset Browser, Timer
  ComfyUI-ZenInspector   install-wide debug panel for nodepacks and extensions
```

### Published vs internal

Four packages are published to npm so node packs outside this repo can build against
them; `core` and `theme` are the runtime's own internals and stay private.

| Package                 |           | Why                                                           |
| ----------------------- | --------- | ------------------------------------------------------------- |
| `@nynxz/zenkit-ui`      | published | components — what most consumers want                         |
| `@nynxz/zenkit-nodekit` | published | `defineNode`, `mountWidget`, `useDragSurface`, `openZenPanel` |
| `@nynxz/zenkit-client`  | published | the `window.ZenKit` contract; re-exports every type           |
| `@nynxz/zenkit-types`   | published | pure types; a transitive dep of the two above                 |
| `@nynxz/zenkit-core`    | internal  | only ComfyUI-ZenKit bundles it                                |
| `@nynxz/zenkit-theme`   | internal  | only core + ComfyUI-ZenKit bundle it                          |

Consumers import types from `client`, never from `types` directly.

### Dependency direction (no cycles)

`types ← theme`, `types ← client`, `types ← core`; `theme ← core`, `ui ← core`.
`ui` and `nodekit` are standalone (only `vue` as a peer). Plugins depend on `client` + `ui`,
never on `core` internals.

## Two ways the packages resolve

Inside this repo, plugins alias `@nynxz/zenkit-*` to package **source** (see
`workspace-aliases.ts`, derived from `tsconfig.plugin.json`), so editing a component needs no
rebuild. The packages' `exports` fields point at built `dist/` instead — that path is for
external consumers installing from npm, or by path during development.

## Dev

```
pnpm install     # link the workspace
pnpm check       # lint + format + typecheck across every package
pnpm build       # build the publishable packages and every plugin
```

Node packs are V3: each plugin's `__init__.py` exposes `comfy_entrypoint`. It must **not**
also define `NODE_CLASS_MAPPINGS` — ComfyUI checks that first and returns early, so leaving
one behind means `comfy_entrypoint` is never called and nothing registers.
