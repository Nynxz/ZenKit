# Your first plugin

A ZenKit plugin is an ordinary ComfyUI custom node folder whose frontend calls
`registerZenPlugin`. This page builds one with a single Vue panel.

## Layout

```
ComfyUI-MyPlugin/
├── __init__.py          # V3 entrypoint, WEB_DIRECTORY = "./js"
├── pyproject.toml
├── package.json
├── vite.config.mts
├── tsconfig.json
├── src/
│   ├── main.ts          # registers with ZenKit
│   └── Hello.vue        # the panel body
└── js/                  # build output (gitignore it)
```

## `pyproject.toml`

```toml
[project]
name = "comfyui-myplugin"
version = "0.1.0"
description = "My first ZenKit plugin. Requires ComfyUI-ZenKit."

[tool.comfy]
PublisherId = "you"
DisplayName = "ComfyUI-MyPlugin"
includes = ["js"]            # ship the built frontend in the registry archive

[tool.zenkit]
id = "myplugin"              # same id you pass to registerZenPlugin
```

`[tool.zenkit] id` is read by the Zen Inspector to join your Python nodes/routes with what the
frontend registered. Keep it identical to the `id` in `registerZenPlugin`.

## `__init__.py`

```python
from comfy_api.latest import ComfyExtension, io


class MyPluginExtension(ComfyExtension):
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return []  # a frontend-only plugin ships no nodes


async def comfy_entrypoint() -> ComfyExtension:
    return MyPluginExtension()


WEB_DIRECTORY = "./js"

__all__ = ["MyPluginExtension", "comfy_entrypoint", "WEB_DIRECTORY"]
```

> Note: do **not** also define `NODE_CLASS_MAPPINGS`. ComfyUI checks for it first and returns
> early, so `comfy_entrypoint` is never called and nothing registers.

Server routes go in their own module, imported at the top of `__init__.py` inside a
`try/except` so a broken route never stops the plugin from loading.

## `package.json`

```json
{
  "name": "comfyui-myplugin",
  "private": true,
  "type": "module",
  "scripts": { "build": "vite build", "dev": "vite build --watch" },
  "dependencies": {
    "@nynxz/zenkit-client": "^0.2.0",
    "@nynxz/zenkit-ui": "^0.2.0",
    "vue": "^3.5.0"
  },
  "devDependencies": {
    "@nynxz/zenkit-nodekit": "^0.2.0",
    "@vitejs/plugin-vue": "^5.2.3",
    "vite": "^6.3.5"
  }
}
```

## `vite.config.mts`

```ts
import { zenPluginConfig } from '@nynxz/zenkit-nodekit/vite'

export default zenPluginConfig({
  name: 'comfyui-myplugin',
  configUrl: import.meta.url,
  sharedRuntime: true,
})
```

`zenPluginConfig` builds `src/main.ts` to `js/main.js`, inlines CSS into it, aliases `@` to
`src/`, and keeps `@comfy/app` / `@comfy/api` external.

| Option          | Default         | Meaning                                                                                                       |
| --------------- | --------------- | ------------------------------------------------------------------------------------------------------------- |
| `name`          | required        | Pack name; also the `data-extension` attribute on the injected `<style>`.                                     |
| `configUrl`     | required        | Always `import.meta.url`.                                                                                     |
| `entry`         | `./src/main.ts` | Entry file.                                                                                                   |
| `outDir`        | `js`            | Must match `WEB_DIRECTORY`.                                                                                   |
| `srcDir`        | `./src`         | What `@` resolves to.                                                                                         |
| `alias`         | `{}`            | Extra aliases (this repo uses it to point at package source).                                                 |
| `sharedRuntime` | `false`         | Import `vue`, `@nynxz/zenkit-ui` and `@nynxz/zenkit-client` from `/zenkit/runtime/` instead of bundling them. |

With `sharedRuntime: true` the page has one Vue and one copy of the UI library, and your bundle
stays small, but the plugin **requires** ComfyUI-ZenKit. Leave it off if the plugin must work
without ZenKit (see [Working without ZenKit](Working-Without-ZenKit.md)).

## `tsconfig.json`

```json
{
  "extends": "@nynxz/zenkit-nodekit/tsconfig.pack.json",
  "compilerOptions": { "paths": { "@/*": ["./src/*"] } },
  "include": ["src", "node_modules/@nynxz/zenkit-nodekit/comfy.d.ts"]
}
```

`comfy.d.ts` declares the ambient `@comfy/app` and `@comfy/api` modules.

## `src/Hello.vue`

```vue
<script setup lang="ts">
import type { PanelContext } from '@nynxz/zenkit-client'
import { ZenButton } from '@nynxz/zenkit-ui'
import { ref } from 'vue'

const props = defineProps<{ ctx?: PanelContext }>()
const count = ref((props.ctx?.state as number | undefined) ?? 0)

function bump() {
  count.value++
  props.ctx?.setState(count.value) // persisted per panel, restored next session
}
</script>

<template>
  <div style="padding: 14px; color: var(--zen-text)">
    <ZenButton icon="mdi mdi-plus" @click="bump">Clicked {{ count }}</ZenButton>
  </div>
</template>
```

## `src/main.ts`

```ts
import { app } from '@comfy/app'
import { mountVue, registerZenPlugin } from '@nynxz/zenkit-client'
import { version } from '../package.json'
import Hello from '@/Hello.vue'

app.registerExtension({
  name: 'you.myplugin',
  setup() {
    void registerZenPlugin({
      id: 'myplugin',
      plugin: 'My Plugin',
      version,
      description: 'A first ZenKit plugin.',
      panels: [
        {
          id: 'hello', // becomes 'myplugin:hello'
          title: 'Hello',
          icon: 'mdi mdi-hand-wave',
          width: 360,
          height: 240,
          render: mountVue(Hello),
        },
      ],
    })
  },
})
```

Call `registerZenPlugin` from the extension's `setup()`. ComfyUI-ZenKit sets
`window.ZenKitPending` as soon as its script loads, so `registerZenPlugin` waits for the runtime
regardless of which extension loads first.

`mountVue(component, props?)` turns a component into a panel `render`. It passes the panel's
`PanelContext` as the `ctx` prop **only if the component declares a `ctx` prop**, and unmounts the
app when ZenKit tears the panel down.

## Build and run

```bash
pnpm install
pnpm build          # or: pnpm dev (rebuilds on save)
```

Link or copy the folder into `ComfyUI/custom_nodes`, restart ComfyUI, reload. "Hello" appears in
the Start menu under **My Plugin**, and the console logs `My Plugin → connected (1 panel)`.

## `registerZenPlugin` at a glance

| Field                                           | Purpose                                                                          | Page                                                              |
| ----------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `id`                                            | Canonical kebab id. Defaults to a slug of `plugin` (`"Zen Suite"` → `zensuite`). |                                                                   |
| `plugin`                                        | Display name; groups entries in the Start menu.                                  |                                                                   |
| `namespace`                                     | Route namespace for apps. Defaults to `id`.                                      | [Apps and routing](Apps-and-Routing.md)                           |
| `version`, `logo`, `description`                | Shown in Zen Settings and the Inspector.                                         |                                                                   |
| `panels`                                        | `ZenPanelDef[]`                                                                  | [Panels and workspaces](Panels-and-Workspaces.md)                 |
| `apps`                                          | `ZenAppDef[]`                                                                    | [Apps and routing](Apps-and-Routing.md)                           |
| `taskbarWidgets`                                | `TaskbarWidget[]`                                                                | [Panels and workspaces](Panels-and-Workspaces.md#taskbar-widgets) |
| `themes`                                        | `ThemePack[]`                                                                    | [Themes](Themes.md)                                               |
| `backgrounds`                                   | `ZenBackground[]`                                                                | [Backgrounds](Backgrounds.md)                                     |
| `channels`                                      | Channel names to declare                                                         | [Channels and media](Channels-and-Media.md)                       |
| `capabilities`                                  | `Capability[]`                                                                   | [Capabilities](Capabilities.md)                                   |
| `slotLinks`                                     | Middle-click a slot to spawn and wire a node                                     | [API reference](API-Reference.md#graph)                           |
| `widgetViews`                                   | Cross-bundle node-widget renderers                                               | [API reference](API-Reference.md#widget-views)                    |
| `setup(zen, { id, namespace })`                 | Imperative escape hatch; may return a cleanup                                    |                                                                   |
| `fallback`, `sidebarFallback`, `app`, `timeout` | Behaviour when ZenKit is absent                                                  | [Working without ZenKit](Working-Without-ZenKit.md)               |

It resolves to `{ connected, zen, unregister }`. `unregister()` removes panels, apps, taskbar
widgets, slot links and capabilities and runs the `setup` cleanup. Themes, backgrounds and
channels have no unregister and stay for the session.
