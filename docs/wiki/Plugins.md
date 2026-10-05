# Plugins

The ComfyUI plugins that live in this repo under `plugins/`. ComfyUI-ZenKit is the host; the rest
are ZenKit plugins built on it.

| Plugin                                        | Adds                                               | Nodes | Needs ComfyUI-ZenKit | In `publish-registry` | Version |
| --------------------------------------------- | -------------------------------------------------- | ----- | -------------------- | --------------------- | ------- |
| [ComfyUI-ZenKit](#comfyui-zenkit)             | `window.ZenKit`, taskbar, panels, themes, settings | none  | is the host          | yes                   | 0.2.0   |
| [ComfyUI-ZenSuite](#comfyui-zensuite)         | Media Viewer, Asset Browser, Timer, channel nodes  | 4     | yes                  | yes                   | 0.2.0   |
| [ComfyUI-ZenInspector](#comfyui-zeninspector) | Install-wide debug panel                           | none  | yes                  | yes                   | 0.2.0   |

More plugins are in progress and will be documented here when they ship.

Every plugin:

- Is a V3 pack: `__init__.py` exposes `comfy_entrypoint`, sets `WEB_DIRECTORY = "./js"`, and does
  not define `NODE_CLASS_MAPPINGS`.
- Registers its Python routes as an import side effect, guarded so a failure never blocks
  ComfyUI from loading.
- Builds its frontend into `js/main.js` with `zenPluginConfig`. All but ComfyUI-ZenKit use
  `sharedRuntime: true`: their `vue`, `@nynxz/zenkit-ui` and `@nynxz/zenkit-client` imports load
  from `/zenkit/runtime/*.js`, so they do not work without ComfyUI-ZenKit.
- Declares `[tool.zenkit] id` in `pyproject.toml`, which ZenInspector reads to match the pack to
  its `registerZenPlugin({ id })` registration.

## ComfyUI-ZenKit

The runtime host. Ships no nodes.

| Part             | What it does                                                                                                                                                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `js/main.js`     | Installs `window.ZenKit` (`installZenKit` from `@nynxz/zenkit-core`), the taskbar, the theme system and the background. Sets `window.ZenKitPending = true` before installing so plugins wait for `zen:ready`. With `?zen-panel=<id>` in the URL it mounts just that panel fullscreen (detached-panel window). |
| `runtime/`       | `vue.js`, `ui.js`, `client.js` (+ `chunks/`), built by `zenRuntimeConfig`: the single Vue, zenkit-ui and zenkit-client every `sharedRuntime` plugin imports                                                                                                                                                   |
| `themes/`        | 25 theme packs as `themes/<id>/theme.json`, discovered at runtime (no rebuild to add one). See [Themes](Themes.md).                                                                                                                                                                                           |
| ComfyUI settings | Background, layout and appearance settings                                                                                                                                                                                                                                                                    |
| Commands         | `ZenKit.openSettings`, `ZenKit.togglePanels`, `ZenKit.Themes` (also placed in the logo menu); an action-bar button opens Zen Settings                                                                                                                                                                         |

Routes:

| Route                                                | Purpose                                                                                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `GET /zenkit/runtime/{path}`                         | Serves `runtime/*.js` (chunks are cached immutable)                                                                       |
| `GET /zenkit/themes`                                 | Theme packs found on disk, with CSS file refs inlined                                                                     |
| `GET /zenkit/thumb?type=&filename=&subfolder=&size=` | Cached JPEG thumbnail of an input/output/temp file (first frame for video). Used by `thumbUrl` in `@nynxz/zenkit-client`. |

> Note: `runtime/` is gitignored and `[tool.comfy] includes` lists only `js`. The
> `publish-registry` workflow force-adds only `plugins/<name>/js`, so as configured the registry
> package of ComfyUI-ZenKit does not contain `runtime/`, which every other plugin needs.

## ComfyUI-ZenSuite

The core panel pack, plus nodes that publish to ZenKit channels.

Panels (registered, none open automatically):

| Panel id          | Title         | Notes                                                                               |
| ----------------- | ------------- | ----------------------------------------------------------------------------------- |
| `zensuite:viewer` | Media Viewer  | Multi-instance; follows a channel (see [Channels and media](Channels-and-Media.md)) |
| `zensuite:assets` | Asset Browser | Browses input/output folders                                                        |
| `zensuite:timer`  | Timer         |                                                                                     |

Capabilities: `viewer.show` and `viewer.merge` (see [Capabilities](Capabilities.md)).

Nodes (category `Zen/Suite`):

| Node id                 | Display name        | Does                                                                        |
| ----------------------- | ------------------- | --------------------------------------------------------------------------- |
| `zen.Channel.SyncImage` | Zen Sync Image      | Publishes an image to a channel; passes it through                          |
| `zen.Channel.Sync`      | Zen Sync            | Publishes an image, mask, video or audio to a channel; passes it through    |
| `zen.Channel.Save`      | Zen Save            | Saves to the output folder (workflow embedded) and publishes the saved file |
| `zen.Channel.Preview`   | Zen Channel Preview | A live wall of recent images on a channel, on the graph                     |

The Sync/Save nodes hide their `channel`/`enable` widgets and show them in a popover from a header
cog; Channel Preview replaces its widgets with a live grid.

Routes: `GET /zensuite/roots`, `/zensuite/assets`, `/zensuite/outputs`, `/zensuite/thumb`
(Asset Browser).

## ComfyUI-ZenInspector

A debug panel for the whole ComfyUI install, not just ZenKit: every node pack and frontend
extension, what each actually registered, and where the sources disagree.

| Registers |                                                                                                                                        |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Panel     | `zeninspector:inspector` (Zen Inspector)                                                                                               |
| Route     | `GET /zeninspector/inspect`: packs that failed to import, versions, git refs, pyproject identity, declared vs effective node ownership |

It joins `/object_info`, `/extensions`, the live page (`app.extensions`, registered node types,
the open graph), the inspect route, and ZenKit's plugin ledger (`window.ZenKit.plugins`).
