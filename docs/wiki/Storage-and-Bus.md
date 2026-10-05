# Storage and bus

`window.ZenKit.storage` persists plugin data in the browser or on the ComfyUI server.
`window.ZenKit.bus` is a page-wide event bus for loose coupling between plugins. This page also
covers the chrome setters (branding, taskbar position and friends) on the root object.

## Storage

### Minimal example

```ts
import { whenZen } from '@nynxz/zenkit-client'

const zen = await whenZen()
const store = zen?.storage.scope('myplugin')

await store?.server.set('presets', [{ name: 'Fast', steps: 8 }])
const presets = (await store?.server.get<{ name: string; steps: number }[]>('presets')) ?? []

await store?.local.set('lastTab', 'history')
```

Always `scope()` under your plugin id so keys don't collide.

### Tiers

| Tier     | Backed by               | Where it lives                                                                                       | Use for                                                                       |
| -------- | ----------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `local`  | `localStorage`          | Key `zenkit:store:<scope>:<key>` in this browser                                                     | UI state, drafts                                                              |
| `server` | ComfyUI `/api/userdata` | `ComfyUI/user/<user>/zen/<scope>/<key>.json` (`<user>` is `default` unless ComfyUI multi-user is on) | Data that should survive a browser wipe or follow the user to another browser |

Both are plaintext. ComfyUI is single-user and local by default: never store secrets here.

### `ZenStore`

| Method            | Meaning                                                                             |
| ----------------- | ----------------------------------------------------------------------------------- |
| `get<T>(key)`     | `Promise<T \| null>`; `null` when missing or unreadable.                            |
| `set(key, value)` | JSON-serializes. `server.set` rejects on failure; `local.set` ignores quota errors. |
| `remove(key)`     | Delete.                                                                             |
| `keys()`          | Keys in this scope.                                                                 |

`scope(name)` returns a new `ZenStorage`; scopes nest (`scope('a').scope('b')` → `zen/a/b/`).
Keys and scope names are reduced to `[a-zA-Z0-9._-]` (other runs become `-`), max 128 characters.

The server tier always writes to the page's own server, even when another plugin has pointed
ComfyUI's API client at another instance.

There is no client wrapper for storage; get the API from `whenZen()`.

## Bus

```ts
import { emitBus, onBus } from '@nynxz/zenkit-client'

const off = await onBus('myplugin:selected', (payload) => console.log(payload))
await emitBus('myplugin:selected', { id: 42 })
off()
```

| `window.ZenKit.bus`     | Meaning                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `on(event, cb)`         | Subscribe; returns unsubscribe. `'*'` receives every event as `{ event, payload }`. |
| `emit(event, payload?)` | Synchronous. A throwing handler is logged and doesn't stop the others.              |
| `off(event, cb)`        | Unsubscribe.                                                                        |

Prefix your own events with your plugin id (`myplugin:…`).

### Events ZenKit emits

| Event                                                                                                         | Payload                                                  |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `panel:open`, `panel:close`, `panel:minimize`, `panel:restore`, `panel:fold`, `panel:focus`, `panel:maximize` | `{ id }`                                                 |
| `panel:reveal`                                                                                                | `{ id }`, a sidebar-pinned panel was asked to show       |
| `panel:pinned`                                                                                                | `{ id }`, the user pinned a panel into ComfyUI's sidebar |
| `registry:change`                                                                                             | none; panel registrations changed                        |
| `app:change`                                                                                                  | `AppLocation`                                            |
| `app:registry`                                                                                                | none; app registrations changed                          |
| `job`, `job:<id>`                                                                                             | `Job`                                                    |
| `jobs:change`                                                                                                 | job id                                                   |
| `channel`, `channel:<name>`                                                                                   | `ChannelImage`                                           |
| `channels:change`                                                                                             | channel name                                             |
| `capabilities:change`                                                                                         | none                                                     |
| `plugins:change`                                                                                              | none; the plugin ledger changed                          |

Theme changes are not on the bus; use `theme.onChange`.

## Chrome setters

Flat setters on `window.ZenKit` for the host's own chrome. The user can change the same things in
Zen Settings.

> Note: these are the least settled part of the contract and may move under a `chrome.*`
> namespace later. Only `setBranding` has a client wrapper.

| Setter                                              | Persisted | Meaning                                                                                                                                                      |
| --------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `setBranding({ logo?, title? })`                    | no        | White-label the Start button. `logo` is an image URL / data URI or an MDI class; `''` falls back to the default. A user override typed in Zen Settings wins. |
| `setTaskbarPos('top' \| 'bottom')`                  | yes       | Taskbar edge.                                                                                                                                                |
| `setAbsorbComfyButtons(on)`                         | yes       | Hide ComfyUI's sidebar-bottom buttons and list them in the Start menu.                                                                                       |
| `setAbsorbCanvasControls(on)`                       | yes       | Show ComfyUI's canvas controls in the taskbar (the `zenkit:canvas-controls` widget).                                                                         |
| `setAppUrlSync(on)`                                 | yes       | Mirror app routes into `#zen=…`; refused inside ComfyUI. See [Apps and routing](Apps-and-Routing.md#url-hash-sync).                                          |
| `setSidebarAutohide(on)`                            | yes       | Slide ComfyUI's left toolbar away until the edge is hovered.                                                                                                 |
| `setFloatingSidebar(on)`                            | yes       | Restyle ComfyUI's open sidebar as a floating card.                                                                                                           |
| `setDebug(verbose)`                                 | no        | Verbose `ZenKit` console logging.                                                                                                                            |
| `setMinimizedAnchor('left' \| 'center' \| 'right')` | no        | Stored but not read by the current taskbar.                                                                                                                  |

### Branding

```ts
import { setBranding } from '@nynxz/zenkit-client'

setBranding({ logo: 'mdi mdi-rocket-launch', title: 'Studio' })
```

Branding resolves field by field: the user's Zen Settings override, then `setBranding`, then
ComfyUI's own name and logo. `setBranding` isn't saved, so call it on every load (from your
plugin's `setup`).
