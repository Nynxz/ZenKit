# Contributing

How the repo is laid out, how packages resolve, the dev loop, and how releases go out.

## Quick start

```sh
pnpm install
pnpm check    # build, then lint, format check and typecheck every package
```

Requirements: Node 20+ (CI uses 22) and pnpm (CI uses 11). Python changes need ComfyUI with the V3
API (`comfy_api.latest`).

## Repo layout

```
packages/
  client    @nynxz/zenkit-client   npm     the window.ZenKit contract (src/contract.ts) + SDK
            client/comfy.d.ts              ambient @comfy/* types every tsconfig includes
  ui        @nynxz/zenkit-ui       npm     Vue components
  nodekit   @nynxz/zenkit-nodekit  npm     node-pack frontend toolkit + Vite preset
  theme     @nynxz/zenkit-theme    private token engine, theme packs
  core      @nynxz/zenkit-core     private the runtime behind window.ZenKit
plugins/
  ComfyUI-ZenKit         host: js/main.js + runtime/ + themes/
  ComfyUI-ZenSuite       ComfyUI-ZenInspector
docs/wiki/               this wiki (published to the GitHub wiki)
workspace-aliases.ts     Vite aliases for in-repo plugin builds
tsconfig.base.json       shared compiler options
tsconfig.plugin.json     paths: @nynxz/zenkit-* -> packages/*/src
```

What each package is for and the dependency graph: [Packages](Packages.md). The plugins:
[Plugins](Plugins.md).

## How packages resolve

The same import resolves differently depending on who is building.

| Consumer                                         | `@nynxz/zenkit-*` resolves to                                                             | Rebuild needed after editing a package? |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------- | --------------------------------------- |
| In-repo plugin, Vite build                       | Package `src/` via `workspace-aliases.ts` (generated from `tsconfig.plugin.json` `paths`) | No                                      |
| In-repo plugin, typecheck                        | Package `src/` via the plugin's `tsconfig.json` `paths`                                   | No                                      |
| A package importing another (e.g. `core` → `ui`) | `node_modules` symlink → that package's `exports` → `dist/`                               | Yes (`pnpm build`)                      |
| External node pack with a `link:` override       | `exports` → `dist/`                                                                       | Yes                                     |
| External node pack from npm                      | the published `dist/`                                                                     | n/a                                     |

`theme` and `core` export `src/index.ts` directly and have no build. `client`, `ui` and
`nodekit` build to `dist/` (Vite for JS, `tsc`/`vue-tsc -p tsconfig.build.json` for
declarations). nodekit's build also bundles the client source it shares and emits its
declarations next to it (`dist/types/`), and copies `packages/client/comfy.d.ts` to its own
`comfy.d.ts` for node packs: edit the client one. That is why `pnpm check` builds before it typechecks, and why CI does the same:
nothing prebuilt is committed.

> Note: most plugins' `tsconfig.json` repeat every `paths` entry from `tsconfig.plugin.json`,
> because adding their own `@/*` alias replaces the inherited `paths` map rather than merging
> with it. Add a new package to all of them, not just `tsconfig.plugin.json`.

## Dev loop

| Command                             | Does                                                                                            |
| ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| `pnpm install`                      | Install and link the workspace                                                                  |
| `pnpm build`                        | `pnpm -r build`: package `dist/`s, every plugin's `js/main.js`, and ComfyUI-ZenKit's `runtime/` |
| `pnpm dev`                          | `vite build --watch` in every package and plugin, in parallel                                   |
| `pnpm typecheck`                    | `pnpm -r typecheck` (needs a prior build, see above)                                            |
| `pnpm lint` / `pnpm lint:fix`       | ESLint (one flat config at the root)                                                            |
| `pnpm format` / `pnpm format:check` | Prettier                                                                                        |
| `pnpm check`                        | `build`, then `lint`, `format:check`, `typecheck`                                               |

Build one plugin and what it depends on:

```sh
pnpm --filter "comfyui-zensuite..." build
```

### Running the plugins in ComfyUI

Plugin bundles land in `plugins/<name>/js/` (and `plugins/ComfyUI-ZenKit/runtime/`). Both are
gitignored, so a fresh clone has no frontend until you build.

1. Make the plugin folders visible to ComfyUI, e.g. symlink each into `ComfyUI/custom_nodes/`.
   Always include ComfyUI-ZenKit: the other plugins load their Vue, zenkit-ui and zenkit-client
   from its `/zenkit/runtime/`.
2. `pnpm build` (or `pnpm dev`), then reload the browser. Restart ComfyUI only after Python
   changes.

ComfyUI-ZenKit's `dev` script (`dev.mjs`) watches both of its builds: `js/main.js` and the shared
`runtime/` that the other plugins load `ui` and `client` from, so a change to either package's
source reaches every plugin.

## Shared runtime vs bundled

`zenPluginConfig({ sharedRuntime })` decides where `vue`, `@nynxz/zenkit-ui` and
`@nynxz/zenkit-client` come from.

|                              | `sharedRuntime: true`                                           | `sharedRuntime: false` (default)         |
| ---------------------------- | --------------------------------------------------------------- | ---------------------------------------- |
| Used by                      | Every in-repo plugin except the host                            | External node packs (NynxzNodes, ZenCut) |
| Those imports                | Left external, loaded from `/zenkit/runtime/{vue,ui,client}.js` | Bundled into the pack's `main.js`        |
| One Vue on the page          | Yes, shared with every Zen plugin                               | Each pack has its own                    |
| Works without ComfyUI-ZenKit | No                                                              | Yes                                      |

ComfyUI-ZenKit builds the runtime with `zenRuntimeConfig` (`vite.runtime.config.mts`). Its own
`js/main.js` bundles `core` (and with it `ui`).

## Python: the V3 entrypoint rule

Every plugin is a V3 pack:

```python
from comfy_api.latest import ComfyExtension, io

class MyExtension(ComfyExtension):
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return []

async def comfy_entrypoint() -> ComfyExtension:
    return MyExtension()

WEB_DIRECTORY = "./js"
```

Do **not** also define `NODE_CLASS_MAPPINGS`. ComfyUI checks for it first and returns early, so
`comfy_entrypoint` is never called and nothing registers.

Register HTTP routes as an import side effect, inside `try`/`except`, so a broken route never
stops the pack loading:

```python
try:
    from . import my_api  # noqa: F401  (registers /myplugin/* on PromptServer)
except Exception as e:
    print(f"[MyPlugin] routes failed to load: {e}")
```

Namespace routes by plugin id (`/zensuite/...`, `/zeninspector/...`).

## Releasing

There are three GitHub workflows in `.github/workflows/`.

| Workflow           | Trigger                       | Does                                                   |
| ------------------ | ----------------------------- | ------------------------------------------------------ |
| `ci`               | push to `main`, pull requests | `pnpm install --frozen-lockfile`, `pnpm check`         |
| `publish-npm`      | manual (`workflow_dispatch`)  | Publishes the three npm packages                       |
| `publish-registry` | manual (`workflow_dispatch`)  | Builds a plugin and publishes it to the Comfy registry |

### publish-npm

1. Bump `version` in the package(s) you're releasing. A version bump is a manual decision; the
   workflow never bumps.
2. Run the workflow. The `dry-run` input defaults to **true** (pack and inspect only); untick it
   to publish.

What it does: `pnpm check`, then `pnpm pack` for `ui`, `nodekit`, `client`, then `npm publish`
of each tarball with `--access public`.

- pnpm packs because it rewrites `workspace:*` to real versions; npm would ship them verbatim.
- npm publishes because it supports npm trusted publishing (OIDC) and provenance; there is no
  `NODE_AUTH_TOKEN`. A new package must be published once by hand and given a trusted publisher on
  npmjs.com before CI can publish it.

### publish-registry

1. Bump the plugin's `version` in `pyproject.toml` (and `package.json`, which the frontend reads).
2. Run the workflow and pick `all`, `ComfyUI-ZenKit`, `ComfyUI-ZenSuite` or `ComfyUI-ZenInspector`.

Per plugin it runs `pnpm --filter "<package>..." build`, fails if `js/main.js` is missing,
`git add -f plugins/<name>/js` (comfy-cli archives tracked files only and `js/` is gitignored;
nothing is committed), then `comfy node publish` with the `REGISTRY_ACCESS_TOKEN` secret. Each
`pyproject.toml` lists `[tool.comfy] includes = ["js"]`.

## Docs

The wiki is generated from `docs/wiki/`, so doc fixes go through pull requests like code. Page
links use the file name: `[Packages](Packages.md)`.
