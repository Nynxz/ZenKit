# Panels and workspaces

A panel is a window your plugin renders into. ZenKit owns the window: it floats, snaps, docks,
tiles into workspaces, minimizes to the taskbar, pops out into its own browser window, and
restores where the user left it on reload.

## Minimal example

```ts
import { mountVue, registerZenPlugin } from '@nynxz/zenkit-client'
import Notes from '@/Notes.vue'

const { zen } = await registerZenPlugin({
  id: 'notes',
  plugin: 'Notes',
  panels: [
    {
      id: 'pad', // registered as 'notes:pad'
      title: 'Notepad',
      icon: 'mdi mdi-note-text-outline',
      width: 420,
      height: 320,
      multi: true, // the Start menu offers "open new" and lists instances
      render: mountVue(Notes),
    },
  ],
})

// Open one from code (e.g. a button elsewhere in your plugin):
zen?.panels
  .registered()
  .find((r) => r.id === 'notes:pad')
  ?.open()
```

> Note: there is no `panels.open(registrationId)`. Open a registered panel through its
> registration's `open()` as above (it applies the def's size, icon and instance numbering).
> `panels.open(spec)` / `openPanel(spec)` open an ad-hoc panel from a full `PanelSpec`.

`render(container, ctx)` fills the panel body and may return a cleanup, run when the panel
closes or its body remounts (docking, pinning and popping out all remount it).

## `ZenPanelDef`

What goes in `registerZenPlugin({ panels })`. It is a `PanelSpec` minus `instanceOf`, plus Start
menu flags.

| Field                   | Type                                    | Default                                | Meaning                                                                             |
| ----------------------- | --------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------- |
| `id`                    | `string`                                | required                               | Short ids get the plugin prefix (`pad` → `notes:pad`); ids containing `:` are kept. |
| `title`                 | `string`                                | required                               | Header and taskbar text.                                                            |
| `icon`                  | `string`                                | `mdi mdi-application-outline`          | MDI class or image URL / data URI.                                                  |
| `render`                | `(el, ctx?) => void \| (() => void)`    | required                               | Fill the body; return cleanup.                                                      |
| `width`, `height`       | `number`                                | `900`, `620`                           | First-open size.                                                                    |
| `minWidth`, `minHeight` | `number`                                | `360`, `280` (`0` for `frame: 'none'`) | Resize floor.                                                                       |
| `dock`                  | `'left' \| 'right' \| 'bottom' \| null` | `null`                                 | Open docked.                                                                        |
| `persist`               | `boolean`                               | `true`                                 | Save geometry and `ctx` state, restore next session.                                |
| `frame`                 | `'default' \| 'none'`                   | `'default'`                            | `'none'` = no chrome; see below.                                                    |
| `multi`                 | `boolean`                               | `false`                                | Allow several live instances.                                                       |
| `spawnOnly`             | `boolean`                               | `false`                                | Hide from the Start menu; open from code only.                                      |
| `sidebarIcon`           | `string`                                | `icon`                                 | Icon for the no-ZenKit sidebar fallback.                                            |
| `open`                  | `(zen, instanceId?) => PanelHandle`     |                                        | Fully custom open. Must return the handle.                                          |

## Opening ad-hoc panels

```ts
import { openPanel } from '@nynxz/zenkit-client'

const handle = await openPanel({
  id: 'notes:scratch',
  title: 'Scratch',
  persist: false,
  render(el) {
    el.textContent = 'temporary'
  },
})
```

`window.ZenKit.panels.open(spec)` is the synchronous equivalent. `PanelSpec` has the same fields
as the table above except `multi` / `spawnOnly` / `sidebarIcon` / `open`, plus:

| Field        | Meaning                                                                                             |
| ------------ | --------------------------------------------------------------------------------------------------- |
| `id`         | Optional when `instanceOf` is set.                                                                  |
| `instanceOf` | A registration id. ZenKit mints `<instanceOf>#<n>` and titles later instances `Title 2`, `Title 3`. |

Opening an id that is already open does not create a second one: it reveals it (restores,
unfolds, brings it to the front, switches to its dock tab or its workspace) and returns its handle.

## Instances

| Call                           | Returns                                            |
| ------------------------------ | -------------------------------------------------- |
| `zen.panels.list()`            | Ids of every open panel                            |
| `zen.panels.instances(typeId)` | `{ id, title }[]` open instances of a registration |
| `zen.panels.get(id)`           | `PanelHandle \| null`                              |
| `zen.panels.registered()`      | All `PanelRegistration`s                           |

Instance ids look like `notes:pad#1`, `notes:pad#2`. A singleton's id is its registration id.

## `PanelContext`

The second argument to `render`, and the `ctx` prop under `mountVue`.

| Member           | Meaning                                                                                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | This panel's id (instance id for multi panels).                                                                                                 |
| `state`          | Last value passed to `setState`, restored across reloads when `persist` is on. Read it live: it updates after `setState` and survives remounts. |
| `setState(blob)` | Save a JSON-serializable blob. Stored in browser `localStorage`, so keep it small.                                                              |
| `expose(api)`    | Publish a summary and commands for other plugins and agents. Returns a withdraw function.                                                       |

```vue
<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import type { PanelContext } from '@nynxz/zenkit-client'

const props = defineProps<{ ctx?: PanelContext }>()
const text = ref((props.ctx?.state as string) ?? '')

const withdraw = props.ctx?.expose({
  describe: () => ({ length: text.value.length }),
  commands: {
    append: {
      description: 'Append text: {text: string}',
      run: ({ text: more }) => (text.value += String(more ?? '')),
    },
  },
})
onBeforeUnmount(() => withdraw?.())
</script>
```

Exposed commands are what the built-in `panels.list` and `panels.command` capabilities show an
agent; see [Capabilities](Capabilities.md).

## `PanelHandle`

| Member                                        | Meaning                                                                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                          | Panel id.                                                                                                                             |
| `close({ keep? })`                            | Close. Without `keep`, its geometry, tile and state are forgotten. `keep: true` remembers them so reopening the same id puts it back. |
| `minimize()`, `restore()`                     | To and from the taskbar.                                                                                                              |
| `fold()`                                      | Toggle collapsed-to-header (floating panels only).                                                                                    |
| `maximize()`                                  | Toggle filling the screen (not for docked panels).                                                                                    |
| `focus()`                                     | Bring to front.                                                                                                                       |
| `setTitle(t)`                                 | Rename; persisted.                                                                                                                    |
| `setIcon(i)`                                  | Swap the icon; not persisted.                                                                                                         |
| `dock(side)`                                  | `'right'`, `'bottom'`, `'left'` or `null` (float). See [Docking](#docking).                                                           |
| `setSize({ w?, h?, x?, y? }, persist = true)` | Move/resize; clamped to the screen and min size.                                                                                      |
| `getRect()`                                   | `{ x, y, w, h }` or `null` when closed.                                                                                               |
| `describe()`                                  | The exposed summary, or `null`.                                                                                                       |
| `commands()`                                  | `{ name, description? }[]` of exposed commands.                                                                                       |
| `run(command, args?)`                         | Run an exposed command. Rejects if the panel isn't mounted or lacks it.                                                               |
| `on(event, cb)`                               | `'close' \| 'minimize' \| 'restore' \| 'fold' \| 'focus'`. Returns unsubscribe.                                                       |

The same events go out on the bus as `panel:<event>` with `{ id }`, plus `panel:open`,
`panel:maximize`, `panel:reveal` and `panel:pinned`. See [Storage and bus](Storage-and-Bus.md).

## `frame: 'none'`

A bare panel: no header, border, background or resize handles. It sizes to its content, keeps its
nearest screen corner as it grows, and is click-through. Only your elements that set
`pointer-events: auto` receive clicks; any element with `class="zen-grip"` gets that plus a grab
cursor and drags the panel. Bare panels never snap or dock.

```ts
openPanel({
  id: 'mascot:buddy',
  title: 'Buddy',
  frame: 'none',
  render(el) {
    el.innerHTML = '<img class="zen-grip" src="/buddy.gif" width="96">'
  },
})
```

## Persistence

With `persist` on (default), ZenKit saves each panel's geometry, status (open / minimized /
folded), dock side, header position, custom title and `ctx` state to `localStorage`
(`zenkit.panels.v1`, `zenkit.panelstate.v1`). When the plugin registers on the next load, the panel
is reopened through the registration's `open()`. User-closing a panel forgets it; use
`close({ keep: true })` when it is closing because its owner went away.

## Docking

| Side                  | What happens                                                                                         |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| `'right'`, `'bottom'` | Joins that dock as a tab. Each dock has a tab rail, one visible tab, and can collapse to the rail.   |
| `'left'`              | Pins into ComfyUI's own sidebar as a tab. Falls back to `'right'` when that sidebar isn't available. |
| `null`                | Floats again at its last free position.                                                              |

Users dock from the panel menu (⋯ or right-click the header → Dock) or by dragging a panel to a
screen edge; Escape cancels a drag. Dragging to the sides and corners away from the docks snaps to
halves and quarters.

## Workspaces

A workspace is a named surface that covers the graph and tiles panels side by side. They are a
user feature: there is no public API for them yet.

| Action                | How                                                                                                                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Switch                | Taskbar switcher (graph, then one pill per workspace), <kbd>Alt</kbd>+<kbd>`</kbd> toggles graph ↔ last workspace, <kbd>Alt</kbd>+<kbd>1</kbd>–<kbd>9</kbd>                             |
| Tile a panel          | Its header's tile button (while a workspace is on screen), the panel menu's "Tile in …", or drag it onto an open workspace (edges tile; hold Shift to split the tile under the pointer) |
| Resize tiles          | Drag a gutter; double-click to even out; drag a junction to move both splits                                                                                                            |
| Untile                | Panel menu → Float, or drag it out                                                                                                                                                      |
| New / rename / remove | `+` on the switcher; double-click a pill to rename; right-click it for more                                                                                                             |

Behaviour worth knowing as a plugin author:

- A tiled panel is still an ordinary panel; your `render` doesn't know it is tiled.
- Revealing a panel (opening an already-open id) switches to the workspace that holds it.
- Opening an app leaves the active workspace, and "Hide panels" steps out of it until panels show
  again.
- Removing a workspace floats its panels rather than closing them.
- While a workspace covers it, the graph and canvas background stop rendering.

## Pop-out windows

"Open in separate window" in the panel menu loads the ComfyUI page again with `?zen-panel=<id>`.
ZenKit boots a minimal runtime there (no taskbar) and mounts just that panel full-window. It
shares `ctx` state with the main window through `localStorage`, and channels, theme and storage
work as usual; `expose` is a no-op there. The panel must be registered (it is looked up by
registration id), and it is not available for docked or sidebar-pinned panels.

## Taskbar widgets

Small always-visible controls in the taskbar, which users can toggle and reorder in
Zen Settings.

```ts
import { mountVue, registerZenPlugin } from '@nynxz/zenkit-client'
import Status from '@/Status.vue'

registerZenPlugin({
  id: 'myplugin',
  plugin: 'My Plugin',
  taskbarWidgets: [
    {
      id: 'myplugin:status',
      label: 'My status',
      icon: 'mdi mdi-circle',
      order: 50,
      render: mountVue(Status),
    },
  ],
})
```

| Field        | Meaning                                                                                                          |
| ------------ | ---------------------------------------------------------------------------------------------------------------- |
| `id`         | Unique. Not auto-prefixed: include your plugin id yourself. Re-registering an id replaces it.                    |
| `label`      | Name in Zen Settings.                                                                                            |
| `icon`       | Icon in Zen Settings.                                                                                            |
| `order`      | Position hint, lower is further left. Used only when the widget is first seen; the user's order wins after that. |
| `defaultOn`  | Shown by default (default `true`).                                                                               |
| `render(el)` | Fill the slot; return cleanup.                                                                                   |

Low level: `window.ZenKit.taskbar.register(widget)` or `registerTaskbarWidget(widget)`, both
returning an unregister function. Built-ins: `zenkit:run` (80), `zenkit:jobs` (90),
`zenkit:hide-panels` (100), `zenkit:canvas-controls` (110).

> Note: panel and capability ids get your plugin prefix automatically; taskbar widget ids don't.
