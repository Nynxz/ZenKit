# Apps and routing

An app is a full-screen surface that covers the graph, with its own routes ("pages"). Use one when
a panel is too small: a dataset browser, a settings area, a gallery. The graph keeps running
underneath, and the taskbar and floating panels stay on top.

## Minimal example

```ts
import { createApp, type Component } from 'vue'
import { registerZenPlugin, type RouteContext } from '@nynxz/zenkit-client'
import List from '@/List.vue'
import Item from '@/Item.vue'

// Mount a Vue component as a route, passing the RouteContext as its `ctx` prop.
const route = (component: Component) => (el: HTMLElement, ctx: RouteContext) => {
  const app = createApp(component, { ctx })
  app.mount(el)
  return () => app.unmount()
}

registerZenPlugin({
  id: 'zendatasets',
  plugin: 'Zen Datasets',
  apps: [
    {
      id: 'datasets',
      title: 'Datasets',
      icon: 'mdi mdi-database',
      routes: [
        { path: '', title: 'All datasets', render: route(List) },
        { path: 'item/:id', title: (p) => `Dataset ${p.id}`, render: route(Item) },
      ],
    },
  ],
})
```

Inside `Item.vue`, `ctx.params.id` is the id and `ctx.router.go('')` goes back to the list.

> Note: `mountVue` works at runtime for routes, but it is typed for panels
> (`ctx?: PanelContext`), so a strict TypeScript build rejects it as a route `render`. Use a small
> helper like `route` above.

## Routing keys

Every app has a **routing key** `<namespace>/<id>`. `registerZenPlugin` sets the namespace to
`def.namespace ?? def.id` (and `id` defaults to a slug of `plugin`), so the app above is
`zendatasets/datasets`, and its item route is the full path `zendatasets/datasets/item/42`.
An app registered with no namespace and no plugin uses its bare `id` as the key.

`apps.open` accepts either the key or the bare app id when the id is unique.

## `ZenAppDef` / `AppRegistration`

`ZenAppDef` is `AppRegistration` without `plugin`, `namespace`, `logo` and `version`, which
`registerZenPlugin` fills in.

| Field       | Type         | Default  | Meaning                                                  |
| ----------- | ------------ | -------- | -------------------------------------------------------- |
| `id`        | `string`     | required | Kebab id, unique within the namespace.                   |
| `title`     | `string`     | required | Start menu, taskbar chip, and chrome title fallback.     |
| `icon`      | `string`     |          | MDI class or image URL.                                  |
| `routes`    | `AppRoute[]` | required | The pages.                                               |
| `home`      | `string`     | `''`     | Route opened when none is given.                         |
| `chrome`    | `boolean`    | `true`   | ZenKit's bar: back to graph, back, forward, icon, title. |
| `persist`   | `boolean`    | `true`   | Reopen this app at its route after a reload.             |
| `spawnOnly` | `boolean`    | `false`  | Hide from the Start menu.                                |

## `AppRoute`

| Field             | Meaning                                                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `path`            | Pattern relative to the app: `''`, `'settings'`, `'item/:id'`. Segment counts must match exactly; `:name` segments capture into `params` (URI-decoded). |
| `title`           | String, or `(params) => string`. Shown in the chrome bar.                                                                                               |
| `render(el, ctx)` | Fill the surface; return cleanup. Runs again on every route change, including a query change.                                                           |

An unknown path falls back to the `home` route; if that doesn't match either, the app shows a
"route not found" notice.

## `RouteContext`

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

| Member                           | Meaning                                                                                      |
| -------------------------------- | -------------------------------------------------------------------------------------------- |
| `go(path, { query?, replace? })` | Relative to the app (`'item/42'`, `''` for home). A leading `/` makes it a full global path. |
| `back()`, `forward()`            | Step through history. The graph is the root entry.                                           |
| `location()`                     | Current `AppLocation`.                                                                       |
| `on(cb)`                         | Called on location changes **within this app**. Returns unsubscribe.                         |

## Global navigation

Navigate through `window.ZenKit.apps`, from `await whenZen()` or `getZenKit()`:

```ts
import { whenZen } from '@nynxz/zenkit-client'

;(await whenZen())?.apps.navigate('zendatasets/datasets/item/42')
```

| `window.ZenKit.apps`                   | Meaning                                                                                                                                   |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `register(reg)`                        | Register; a key that exists is replaced. Returns an unregister that removes only this registration. Prefer `registerZenPlugin({ apps })`. |
| `registered()`                         | All registrations.                                                                                                                        |
| `open(idOrKey, { path?, query? })`     | Launch; returns `AppHandle { id, router, close }` (`id` is the routing key).                                                              |
| `navigate(path, { query?, replace? })` | Full path, e.g. `'zendatasets/datasets/item/42?tab=files'`. `''` or `'/'` is the graph.                                                   |
| `close()`                              | Back to the graph.                                                                                                                        |
| `restore()`                            | Re-enter the app last closed, at its route. `false` if none.                                                                              |
| `minimized()`                          | The closed-but-remembered `AppLocation`, or `null`.                                                                                       |
| `current()`                            | Active routing key, or `null` on the graph.                                                                                               |
| `location()`                           | `{ app, path, params, query }`; `app` is the routing key or `null`.                                                                       |
| `back()`, `forward()`                  | Global history.                                                                                                                           |
| `on(cb)`                               | Every location change. Also on the bus as `app:change`.                                                                                   |

## Minimize and restore

Closing an app (`close()`, the chrome's home button, or the taskbar chip) drops to the graph but
keeps the app's chip on the taskbar. Clicking the chip calls `restore()` and returns to the same
route. Entering any app clears the remembered one.

Apps and workspaces both cover the graph, so opening an app leaves the active workspace and
switching to a workspace closes the app.

## Reload and late registration

The active location is saved to `localStorage` (`zenkit.apps.v1`). Plugins register apps
asynchronously, so a saved or navigated-to path whose app isn't registered yet is held, and
resolved the moment that app registers. Set `persist: false` to opt an app out.

## URL hash sync

`window.ZenKit.chrome.set({ appUrlSync: true })` mirrors the location into `location.hash` as `#zen=<path>`, so
browser back/forward and shared links work. It is off by default and is refused (logged, left
off) whenever ComfyUI is on the page, because ComfyUI's frontend uses `location.hash` for subgraph
navigation. In practice it only applies to a standalone ZenKit page.
