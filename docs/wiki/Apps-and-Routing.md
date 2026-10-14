# Apps and routing

An app is a full-screen surface that covers the graph, with its own routes ("pages"). Use one when
a panel is too small: a dataset browser, a gallery, a chat. The graph keeps running underneath,
and the taskbar and floating panels stay on top.

Open apps run like windows. Each has a chip on the taskbar, one shows at a time (or none, and the
graph shows), and minimizing an app keeps it mounted, so it comes back exactly as it was left.
Closing it unmounts it and takes it off the taskbar.

## Minimal example

Most apps mount one component for as long as they run and follow their routes from it:

```ts
import { mountVueApp, registerZenPlugin } from '@nynxz/zenkit-client'
import Datasets from '@/Datasets.vue'

registerZenPlugin({
  id: 'zendatasets',
  plugin: 'Zen Datasets',
  apps: [
    {
      id: 'datasets',
      title: 'Datasets',
      icon: 'mdi mdi-database',
      routes: [
        { path: '', title: 'All datasets' },
        { path: 'item/:id', title: (p) => `Dataset ${p.id}` },
      ],
      mount: mountVueApp(Datasets),
    },
  ],
})
```

```vue
<!-- Datasets.vue -->
<script setup lang="ts">
import { useAppLocation, type AppContext } from '@nynxz/zenkit-client'

const props = defineProps<{ ctx: AppContext }>()
const loc = useAppLocation(props.ctx.router)
</script>

<template>
  <DatasetList v-show="loc.route === ''" @open="(id) => ctx.router.go(`item/${id}`)" />
  <DatasetItem v-if="loc.route === 'item/:id'" :id="loc.params.id" />
</template>
```

The list stays mounted (`v-show`) while an item is open, so going back finds it scrolled where it
was. ZenKit's back and forward step through the app's routes.

A node pack (nodekit) does the same with one call; see [Node packs](#node-packs).

### Rendering per route

An app can instead render each route itself, leaving `mount` out and giving every route a
`render`. The surface is torn down and rendered again on every route change, which suits apps
whose pages share nothing:

```ts
import { createApp, type Component } from 'vue'
import type { RouteContext } from '@nynxz/zenkit-client'

// Mount a Vue component as a route, passing the RouteContext as its `ctx` prop.
const route = (component: Component) => (el: HTMLElement, ctx: RouteContext) => {
  const app = createApp(component, { ctx })
  app.mount(el)
  return () => app.unmount()
}

routes: [
  { path: '', title: 'All datasets', render: route(List) },
  { path: 'item/:id', title: (p) => `Dataset ${p.id}`, render: route(Item) },
]
```

Inside `Item.vue`, `ctx.params.id` is the id and `ctx.router.go('')` goes back to the list.

## Routing keys

Every app has a **routing key** `<namespace>/<id>`. `registerZenPlugin` sets the namespace to
`def.namespace ?? def.id` (and `id` defaults to a slug of `plugin`), so the app above is
`zendatasets/datasets`, and its item route is the full path `zendatasets/datasets/item/42`.
An app registered with no namespace and no plugin uses its bare `id` as the key.

`apps.open`, `apps.close` and `apps.restore` accept either the key or the bare app id when the id
is unique.

## `ZenAppDef` / `AppRegistration`

`ZenAppDef` is `AppRegistration` without `plugin`, `namespace`, `logo` and `version`, which
`registerZenPlugin` fills in.

| Field            | Type         | Default  | Meaning                                                                                                  |
| ---------------- | ------------ | -------- | -------------------------------------------------------------------------------------------------------- |
| `id`             | `string`     | required | Kebab id, unique within the namespace.                                                                   |
| `title`          | `string`     | required | Start menu, taskbar chip, and chrome title fallback.                                                     |
| `icon`           | `string`     |          | MDI class or image URL.                                                                                  |
| `routes`         | `AppRoute[]` | required | The pages.                                                                                               |
| `mount(el, ctx)` | function     |          | Mount the app once, for as long as it runs; return cleanup (run on close). Routes then need no `render`. |
| `home`           | `string`     | `''`     | Route opened when none is given.                                                                         |
| `chrome`         | `boolean`    | `true`   | ZenKit's bar: back, forward, icon, title; minimize and close on the right.                               |
| `persist`        | `boolean`    | `true`   | Bring the app back (running, at its route) after a reload.                                               |
| `spawnOnly`      | `boolean`    | `false`  | Hide from the Start menu.                                                                                |

## `AppRoute`

| Field             | Meaning                                                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `path`            | Pattern relative to the app: `''`, `'settings'`, `'item/:id'`. Segment counts must match exactly; `:name` segments capture into `params` (URI-decoded). |
| `title`           | String, or `(params) => string`. Shown in the chrome bar.                                                                                               |
| `render(el, ctx)` | Only without `mount`. Fill the surface; return cleanup. Runs again on every route change of this app, including a query change.                         |

An unknown path falls back to the `home` route; if that doesn't match either, the app shows a
"route not found" notice.

## `AppContext`

What `mount` receives. It lasts as long as the app runs.

| Member           | Meaning                                                                      |
| ---------------- | ---------------------------------------------------------------------------- |
| `app`            | The bare app id.                                                             |
| `key`            | The routing key.                                                             |
| `router`         | `AppRouter` scoped to this app. Follow routes with `useAppLocation(router)`. |
| `state`          | Per-app persisted blob (the same one routes see).                            |
| `setState(blob)` | Save it (`localStorage`, key `zenkit.appstate.v1`).                          |

`useAppLocation(router)` (in `@nynxz/zenkit-client`, and re-exported by nodekit) returns a
readonly ref of the app's `AppLocation`, updated on every route change, while minimized too.
`mountVueApp(component, props?)` is a `mount` that mounts a Vue component with the context as its
`ctx` prop.

## `RouteContext`

What a route's `render` receives.

| Member           | Meaning                                                         |
| ---------------- | --------------------------------------------------------------- |
| `app`            | The bare app id (not the routing key).                          |
| `route`          | The matched pattern, e.g. `'item/:id'`.                         |
| `params`         | Path params.                                                    |
| `query`          | Query-string params.                                            |
| `router`         | `AppRouter` scoped to this app.                                 |
| `state`          | Per-app persisted blob (one per app, shared by all its routes). |
| `setState(blob)` | Save it (`localStorage`, key `zenkit.appstate.v1`).             |

`state` is live, like `PanelContext.state`: reading it after `setState` returns what was just set.

## `AppRouter`

| Member                           | Meaning                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `go(path, { query?, replace? })` | Relative to the app (`'item/42'`, `''` for home). A leading `/` makes it a full global path.           |
| `back()`, `forward()`            | Step through **this app's** history. It never leaves the app: minimize or close it to reach the graph. |
| `location()`                     | This app's `AppLocation`: where it is, or where it was left while minimized.                           |
| `on(cb)`                         | Called on location changes **within this app**. Returns unsubscribe.                                   |

`AppLocation` is `{ app, path, route, params, query }`: `app` is the routing key (`null` for the
graph) and `route` the pattern `path` matched.

## Global navigation

Navigate through `window.ZenKit.apps`, from `await whenZen()` or `getZenKit()`:

```ts
import { whenZen } from '@nynxz/zenkit-client'

;(await whenZen())?.apps.navigate('zendatasets/datasets/item/42')
```

| `window.ZenKit.apps`                   | Meaning                                                                                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `register(reg)`                        | Register; a key that exists is replaced. Returns an unregister that removes only this registration. Prefer `registerZenPlugin({ apps })`.        |
| `registered()`                         | All registrations.                                                                                                                               |
| `open(idOrKey, { path?, query? })`     | Show an app; returns `AppHandle { id, router, close }` (`id` is the routing key). A running app comes back where it was unless a route is given. |
| `navigate(path, { query?, replace? })` | Full path, e.g. `'zendatasets/datasets/item/42?tab=files'`. `''` or `'/'` is the graph (the active app is minimized).                            |
| `minimize()`                           | Back to the graph; the active app keeps running.                                                                                                 |
| `close(idOrKey?)`                      | Stop an app (the active one by default): it unmounts and leaves the taskbar.                                                                     |
| `restore(idOrKey?)`                    | Show a running app where it was left (the one last minimized by default). `false` if there isn't one.                                            |
| `running()`                            | Every running app's `AppLocation`, in taskbar order.                                                                                             |
| `minimized()`                          | The running app last minimized, or `null`.                                                                                                       |
| `current()`                            | Active routing key, or `null` on the graph.                                                                                                      |
| `location()`                           | The active `AppLocation`.                                                                                                                        |
| `back()`, `forward()`                  | The active app's history.                                                                                                                        |
| `on(cb)`                               | Every location change. Also on the bus as `app:change`.                                                                                          |

## Running apps

Opening an app adds a chip to the taskbar. Clicking the active app's chip, the chrome's minimize
button, or `minimize()` drops to the graph with the app still mounted: a stream it is reading or a
job it is watching carries on. Clicking a minimized chip shows it again where it was. The chip's
✕ (or a middle-click), the chrome's close button, or `close()` stops it.

An app's surface mounts the first time it is shown, and stays mounted until it closes. Keep what
a minimized app does in the background cheap; anything heavy should pause while
`apps.current()` isn't its key.

Apps and workspaces both cover the graph, so showing an app full screen leaves the active
workspace, and switching to a workspace minimizes it. While an app is full screen the graph stops
drawing, and a panel dragged to a screen edge floats or snaps instead of docking under it.

## Apps in workspaces

An app can also sit in a workspace tile, beside panels: the chrome's tile button (or
`tileApp(key)` in core) moves it into the active workspace (else the last, else a new one). It
lays out, resizes and saves with the workspace like a tiled panel; its tile id is `app:<key>`.

- Its routes move it within the tile: `router.go` never takes a tiled app full screen.
- Opening or restoring it (its taskbar chip, the Start menu, `apps.open`) shows its workspace.
- The tile's chrome has back, forward and the title, then full screen (out of the workspace,
  `untileApp`) and close.
- It stays mounted while its workspace is off screen, as a minimized app does.

## Node packs

nodekit's `registerZenApp(entry, Component)` registers a mounted app for a node pack, like
`registerZenPanel`: it waits for ZenKit, mounts `Component` once with the `ctx` prop, and
resolves to `null` without ZenKit, so the pack can offer another way in.

```ts
import { registerZenApp } from '@nynxz/zenkit-nodekit'

void registerZenApp(
  {
    id: 'browser',
    title: 'CivitAI',
    icon: 'mdi mdi-palette-swatch-outline',
    plugin: 'ZenCivit',
    namespace: 'zencivit',
    routes: [{ path: '' }, { path: 'model/:id', title: 'Model' }],
  },
  CivitBrowser,
)
```

`routes` defaults to a single index route. `useAppLocation` and the `AppContext` type are
re-exported from nodekit too.

## Reload and late registration

The active location and the running apps are saved to `localStorage` (`zenkit.apps.v1`). Plugins
register apps asynchronously, so a saved or navigated-to path whose app isn't registered yet is
held, and resolved the moment that app registers; running apps come back as chips, mounting when
first shown. Set `persist: false` to opt an app out.

## URL hash sync

`window.ZenKit.chrome.set({ appUrlSync: true })` mirrors the location into `location.hash` as `#zen=<path>`, so
browser back/forward and shared links work. It is off by default and is refused (logged, left
off) whenever ComfyUI is on the page, because ComfyUI's frontend uses `location.hash` for subgraph
navigation. In practice it only applies to a standalone ZenKit page.
