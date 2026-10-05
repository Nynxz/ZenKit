# Installing

ComfyUI-ZenKit is the host plugin. It installs `window.ZenKit`, the taskbar and the theme
system, and serves the shared runtime that every other Zen plugin loads. It ships no nodes.

## From the Comfy Registry

Search for **ComfyUI-ZenKit** in ComfyUI-Manager, or use comfy-cli:

```bash
comfy node install comfyui-zenkit
```

Restart ComfyUI and reload the browser tab.

## From source

The plugins live in a pnpm monorepo, so clone it outside `custom_nodes`, build it, then link the
plugin folders in. Built bundles (`js/`, and `runtime/` for ComfyUI-ZenKit) are gitignored, so a
plain clone has no frontend until you build.

```bash
git clone https://github.com/Nynxz/ZenKit.git
cd ZenKit
pnpm install
pnpm build                      # needs Node >= 20

# Link the host (and any companions) into ComfyUI
ln -s "$PWD/plugins/ComfyUI-ZenKit" /path/to/ComfyUI/custom_nodes/ComfyUI-ZenKit
```

On Windows use `mklink /D` instead of `ln -s`.

## What you get

| Where                         | What                                                                                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bottom (or top) of the screen | The **taskbar**: Start button, workspace switcher, open and minimized panels, the active app chip, and widgets (Jobs, Run, Hide panels, Canvas controls).    |
| Start button                  | The **Start menu** (called the ZenBar in some type comments): every registered panel and app grouped by plugin, pinning, theme picker and light/dark toggle. |
| ComfyUI top bar               | A tune icon that opens **Zen Settings**. Also `ZenKit: Open Zen Settings` in the command palette.                                                            |
| ComfyUI logo menu             | **ZenKit Themes**, a theme switcher next to ComfyUI's own.                                                                                                   |
| ComfyUI Settings → ZenKit     | Canvas background, image, finish and effect settings (see [Backgrounds](Backgrounds.md)).                                                                    |

Zen Settings has three tabs:

| Tab      | Contents                                                                                                                                                                                                                                                        |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plugins  | Every ZenKit plugin with its version. Disabling one hides its panels and closes any open ones; the Python side stays loaded.                                                                                                                                    |
| Logs     | ZenKit's recent console output and window errors.                                                                                                                                                                                                               |
| Settings | Taskbar edge and floating style, Start-button name and icon, absorb ComfyUI sidebar buttons / canvas controls, themed startup splash, theme menu, app URL sync, sidebar auto-hide and restyle, debug logging, and the taskbar widget list (toggle and reorder). |

Keyboard: <kbd>Alt</kbd>+<kbd>`</kbd> flips between the graph and the last workspace,
<kbd>Alt</kbd>+<kbd>1</kbd>–<kbd>9</kbd> jump to a workspace.

## Companion plugins

Install these the same way. All of them need ComfyUI-ZenKit: they load
Vue and the ZenKit libraries from its `/zenkit/runtime/` route rather than bundling their own.

| Plugin               | What it adds                                                                | Registry               |
| -------------------- | --------------------------------------------------------------------------- | ---------------------- |
| ComfyUI-ZenSuite     | Media Viewer, Asset Browser, Timer panels; Zen Sync / Channel Preview nodes | `comfyui-zensuite`     |
| ComfyUI-ZenInspector | A debug panel listing every node pack and what it registered                | `comfyui-zeninspector` |

See [Plugins](Plugins.md) for details.

## Checking it worked

The server log prints `[ZenKit] frontend extension loaded`. The browser console shows one
`ZenKit <plugin> → connected (…)` line per plugin, and:

```js
window.ZenKit.version // "0.2.0"
window.ZenKit.plugins.registered().map((p) => p.id)
```

> Note: a plugin that logs `ZenKit not detected` either loaded on a page without ComfyUI-ZenKit,
> or ZenKit failed to install. Check the Logs tab and the server console.
