# Working without ZenKit

Every `@nynxz/zenkit-client` helper waits for the runtime and quietly does nothing (or a sensible
fallback) when ComfyUI-ZenKit isn't installed, so one plugin build can run on both kinds of
install.

## Minimal example

```ts
import { app } from '@comfy/app'
import { mountVue, registerZenPlugin } from '@nynxz/zenkit-client'
import Hello from '@/Hello.vue'

app.registerExtension({
  name: 'you.myplugin',
  async setup() {
    const { connected } = await registerZenPlugin({
      id: 'myplugin',
      plugin: 'My Plugin',
      panels: [{ id: 'hello', title: 'Hello', render: mountVue(Hello) }],
      app, // needed for sidebarFallback
      sidebarFallback: true, // no ZenKit: each panel becomes a ComfyUI sidebar tab
    })
    if (!connected) console.info('running without ZenKit')
  },
})
```

> Note: this only helps a plugin that **bundles** its own Vue and ZenKit libraries
> (`zenPluginConfig({ sharedRuntime: false })`, the default). A `sharedRuntime: true` build
> imports them from ComfyUI-ZenKit's `/zenkit/runtime/` route and fails to load at all without
> it. Node packs built on nodekit talk to `window.ZenKit` directly; see
> [Nodekit pack pattern](Nodekit-Pack-Pattern.md).

## Detecting the runtime

| Export                | Returns                      | Notes                                              |
| --------------------- | ---------------------------- | -------------------------------------------------- |
| `getZenKit()`         | `ZenKitApi \| null`          | Synchronous. Null until the runtime has installed. |
| `hasZenKit()`         | `boolean`                    | `getZenKit() != null`.                             |
| `whenZen(timeout?)`   | `Promise<ZenKitApi \| null>` | Use this. See below.                               |
| `ZEN_CONNECT_TIMEOUT` | `6000`                       | Default `timeout` in ms.                           |

`whenZen` resolves:

| Situation                                                                             | Result                                                                              |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `window.ZenKit` already set                                                           | its `ready` promise (the API)                                                       |
| `window.ZenKitPending` is true (the host script has loaded, runtime still installing) | waits for the `zen:ready` window event, with **no** timeout                         |
| Neither                                                                               | waits up to `timeout` ms for `zen:ready`, then resolves `null` and logs one warning |
| The host's install threw                                                              | the host clears `ZenKitPending` and fires `zen:ready`, so this resolves `null`      |

ComfyUI-ZenKit sets `window.ZenKitPending = true` the moment its script runs, before it fetches
themes and installs. That is what makes load order irrelevant: a plugin whose `setup()` runs first
just waits.

You can listen for the event yourself:

```ts
window.addEventListener('zen:ready', () => console.log(window.ZenKit?.version), { once: true })
```

## Fallbacks in `registerZenPlugin`

| Field             | Type         | Behaviour when ZenKit is absent                                                                  |
| ----------------- | ------------ | ------------------------------------------------------------------------------------------------ |
| `fallback`        | `() => void` | Called once. Wins over `sidebarFallback`.                                                        |
| `sidebarFallback` | `boolean`    | Registers one ComfyUI sidebar tab per panel (skipping `spawnOnly`). Needs `app`. Off by default. |
| `app`             | `unknown`    | ComfyUI's `app` from `@comfy/app`, for `sidebarFallback`.                                        |
| `timeout`         | `number`     | ms passed to `whenZen`. Default `ZEN_CONNECT_TIMEOUT`.                                           |

A sidebar tab uses `sidebarIcon ?? icon ?? 'mdi mdi-application-outline'`, and its id is the
prefixed panel id with non-alphanumerics replaced by `-`. Its `render` gets **no** `ctx`, so a
`mountVue` component sees `ctx` as `undefined`; write panels so `ctx?.` is optional.

With neither field set, the call logs a warning and resolves
`{ connected: false, zen: null, unregister: () => {} }`.

`widgetViews` are registered either way: they live in a window global, not in ZenKit.

## What each helper does without ZenKit

| Helper                                                                                                                                            | Without ZenKit                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `registerZenPlugin`                                                                                                                               | Runs the fallback, `connected: false`                                               |
| `openPanel`, `openApp`                                                                                                                            | Resolve `null`                                                                      |
| `registerPanel`, `registerZenApp`, `registerTaskbarWidget`, `registerSlotLink`, `onSlotMiddleClick`, `onBus`, `onJob`, `onAppChange`, `onChannel` | Resolve a no-op unsubscribe                                                         |
| `emitBus`, `setBranding`, `navigateApp`, `publishChannel`, `declareChannel`                                                                       | Do nothing                                                                          |
| `startJob`                                                                                                                                        | Resolves a handle whose methods do nothing (`id` is `''`)                           |
| `useJob`                                                                                                                                          | Ref stays `null`                                                                    |
| `openViewer`                                                                                                                                      | Opens the item at `opts.index` (default 0) in a new tab; resolves `null`            |
| `useLightbox().open`                                                                                                                              | Same new-tab fallback; `isOpen` stays false                                         |
| `thumbUrl`                                                                                                                                        | Still returns `/zenkit/thumb?…`, which 404s (the route is served by ComfyUI-ZenKit) |
| Drag-and-drop helpers, `mediaKindOf`, `registerWidgetView`, `getWidgetView`                                                                       | Work normally (no runtime needed)                                                   |

When the host never announced itself, every async helper call waits the full
`ZEN_CONNECT_TIMEOUT` before giving up (the result is not cached). Check `hasZenKit()` once and
skip the calls instead of `await`ing them on a hot path.
