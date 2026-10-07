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
zen?.panels.open('notes:pad')
```

`panels.open(id)` opens the registered panel with that id through its registration (so the def's
size, icon and instance numbering apply): a new instance for a `multi` panel, or the singleton,
revealed if it is already open. An id that isn't registered but is open (an ad-hoc panel, or an
instance id like `notes:pad#2`) is revealed. It returns `null` when there is neither.
`panels.open(spec)` opens an ad-hoc panel from a full `PanelSpec`.

`render(container, ctx)` fills the panel body and may return a cleanup, run when the panel
closes or its body remounts (docking, pinning and popping out all remount it).

## `ZenPanelDef`

What goes in `registerZenPlugin({ panels })`. It is a `PanelSpec` minus `instanceOf`, plus Start
menu flags.

| Field                   | Type                                 | Default                                | Meaning                                                                             |
| ----------------------- | ------------------------------------ | -------------------------------------- | ----------------------------------------------------------------------------------- |
| `id`                    | `string`                             | required                               | Short ids get the plugin prefix (`pad` → `notes:pad`); ids containing `:` are kept. |
| `title`                 | `string`                             | required                               | Header and taskbar text.                                                            |
| `icon`                  | `string`                             | `mdi mdi-application-outline`          | MDI class or image URL / data URI.                                                  |
| `render`                | `(el, ctx?) => void \| (() => void)` | required                               | Fill the body; return cleanup.                                                      |
| `width`, `height`       | `number`                             | `900`, `620`                           | First-open size.                                                                    |
| `minWidth`, `minHeight` | `number`                             | `360`, `280` (`0` for `frame: 'none'`) | Resize floor.                                                                       |
| `dock`                  | `DockSide`                           | `null`                                 | Open docked; see [Docking](#docking).                                               |
| `persist`               | `boolean`                            | `true`                                 | Save geometry and `ctx` state, restore next session.                                |
| `frame`                 | `'default' \| 'none'`                | `'default'`                            | `'none'` = no chrome; see below.                                                    |
| `multi`                 | `boolean`                            | `false`                                | Allow several live instances.                                                       |
| `spawnOnly`             | `boolean`                            | `false`                                | Hide from the Start menu; open from code only.                                      |
| `sidebarIcon`           | `string`                             | `icon`                                 | Icon for the no-ZenKit sidebar fallback.                                            |
| `open`                  | `(zen, instanceId?) => PanelHandle`  |                                        | Fully custom open. Must return the handle.                                          |

## Opening ad-hoc panels

```ts
import { whenZen } from '@nynxz/zenkit-client'

const handle = (await whenZen())?.panels.open({
  id: 'notes:scratch',
  title: 'Scratch',
  persist: false,
  render(el) {
    el.textContent = 'temporary'
  },
})
```

`handle` is `undefined` when ZenKit isn't installed. `PanelSpec` has the same fields
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
| `zen.panels.open(id \| spec)`  | `PanelHandle` (`null` for an unknown id)           |
| `zen.panels.close(id, opts?)`  | Close; `{ keep: true }` as on the handle           |
| `zen.panels.list()`            | Ids of every open panel                            |
| `zen.panels.instances(typeId)` | `{ id, title }[]` open instances of a registration |
| `zen.panels.get(id)`           | `PanelHandle \| null`                              |
| `zen.panels.registered()`      | All `PanelRegistration`s                           |

Instance ids look like `notes:pad#1`, `notes:pad#2`. A singleton's id is its registration id.

Every panel's root element carries `data-zen-panel-id="<id>"` (also inside ComfyUI's sidebar when
it is pinned there), for tests, theme CSS and anything that needs to find it in the DOM.

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

| Member                                        | Meaning                                                                                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                          | Panel id.                                                                                                                                         |
| `close({ keep? })`                            | Close. Without `keep`, its geometry, tile and state are forgotten. `keep: true` remembers them so reopening the same id puts it back.             |
| `minimize()`, `restore()`                     | To and from the taskbar.                                                                                                                          |
| `fold()`                                      | Toggle collapsed-to-header (floating panels only).                                                                                                |
| `maximize()`                                  | Toggle filling the screen (not for docked panels).                                                                                                |
| `focus()`                                     | Bring into view wherever it lives: un-minimize, raise a float, make a docked one its dock's active tab, show its sidebar tab or its workspace.    |
| `setTitle(t)`                                 | Rename; persisted.                                                                                                                                |
| `setIcon(i)`                                  | Swap the icon; not persisted.                                                                                                                     |
| `dock(side)`                                  | `'right'`, `'bottom'`, `'left'`, `'sidebar'` or `null` (float). See [Docking](#docking).                                                          |
| `setSize({ w?, h?, x?, y? }, persist = true)` | Move/resize; clamped to the screen and min size. A docked panel resizes its dock instead (`w` for a side dock, `h` for the bottom).               |
| `getRect()`                                   | Where it renders, measured (right for floating, docked, tiled and sidebar-pinned panels). Off screen, the rect it would take. `null` when closed. |
| `describe()`                                  | The exposed summary, or `null`.                                                                                                                   |
| `commands()`                                  | `{ name, description? }[]` of exposed commands.                                                                                                   |
| `run(command, args?)`                         | Run an exposed command. Rejects if the panel isn't mounted or lacks it.                                                                           |
| `on(event, cb)`                               | `'open' \| 'close' \| 'minimize' \| 'restore' \| 'fold' \| 'maximize' \| 'focus'`. Returns unsubscribe.                                           |

The same events go out on the bus as `panel:<event>` with `{ id }`, plus `panel:reveal` and
`panel:pinned`. See [Storage and bus](Storage-and-Bus.md).

## `frame: 'none'`

A bare panel: no header, border, background or resize handles. It sizes to its content, keeps its
nearest screen corner as it grows, and is click-through. Only your elements that set
`pointer-events: auto` receive clicks; any element with `class="zen-grip"` gets that plus a grab
cursor and drags the panel. Bare panels never snap or dock.

```ts
getZenKit()?.panels.open({
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

| `DockSide`            | What happens                                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `'right'`, `'bottom'` | Joins that ZenKit dock as a tab. Each dock shows one tab at a time and can collapse.                                    |
| `'sidebar'`           | Pins into ComfyUI's own sidebar, one rail tab per panel. Without that sidebar it falls back to ZenKit's left dock.      |
| `'left'`              | The left edge: ComfyUI's sidebar when the frontend has one (the same as `'sidebar'`), otherwise ZenKit's own left dock. |
| `null`                | Floats again at its last free position (a centred default if it never floated).                                         |

Users dock from the panel menu (⋯ or right-click the header → Dock) or by dragging a panel to a
screen edge; Escape cancels a drag. Dragging to the sides and corners away from the docks snaps to
halves and quarters.

A side dock titles its panels on its tab rail. The bottom dock has no rail (its tabs are icons in
the taskbar), so a panel docked there keeps a title bar with float, collapse and close buttons;
drag the bar to pull it out.

### Getting out of ComfyUI's sidebar

A panel pinned into the sidebar shows its title bar at the top of the sidebar tab, with a
**Pop out** button (the dock-window icon) on the right. It unpins the panel, closes the sidebar
tab and floats the panel at its last free position, keeping its state. This works on every
frontend; dragging the bar (or the rail icon) out of the sidebar works too where the frontend lets
a drag start there. From code, `handle.dock(null)` does the same. Pinning it again later re-uses
the tab's toggle command, so the frontend doesn't warn about a duplicate.

### `zen.docks`

| Call                                              | Meaning                                                                                                                       |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `docks.get(side)`                                 | `{ members, active, size, collapsed }` for `'left'`, `'right'` or `'bottom'`: tab ids in order, the shown tab, requested px.  |
| `docks.set(side, { active?, size?, collapsed? })` | Show a tab (it must be docked on that side), resize (width for a side, height for the bottom; layout clamps it), or collapse. |

```ts
const zen = await whenZen()
const notes = zen?.panels.open('notes:pad')
notes?.dock('right')
zen?.docks.set('right', { size: 420 })
notes?.focus() // its tab shows, the dock expands
```

## Workspaces

A workspace is a named surface that covers the graph and tiles panels side by side. At most one is
on screen; none means the graph itself.

| Action                | How                                                                                                                                                                                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Switch                | Taskbar switcher (the graph, then a tab per workspace with its name and panel count; more than 4 collapse to the active tab plus a list), <kbd>Alt</kbd>+<kbd>`</kbd> toggles graph ↔ last workspace, <kbd>Alt</kbd>+<kbd>1</kbd>–<kbd>9</kbd> |
| Tile a panel          | Its header's tile button (while a workspace is on screen), the panel menu's "Tile in …", or drag it onto an open workspace (edges tile; hold Shift to split the tile under the pointer)                                                        |
| Resize tiles          | Drag a gap grip; double-click or Enter to even out; drag a junction to move both splits. Focus a grip and use arrows (Shift = 5×), or Home/End. Escape cancels a drag.                                                                         |
| Untile                | Panel menu → Float, or drag it out                                                                                                                                                                                                             |
| New / rename / remove | `+` on the switcher; double-click a pill to rename; right-click it for more                                                                                                                                                                    |

Behaviour worth knowing as a plugin author:

- A tiled panel is still an ordinary panel; your `render` doesn't know it is tiled.
- Revealing a panel (opening an already-open id) switches to the workspace that holds it.
- The taskbar lists the panels that belong on screen: floating ones (they show over the graph and
  every workspace) and those tiled in the workspace on screen. Another workspace's panels sit behind
  its tab: hover it for their names, right-click it to jump straight to one.
- Opening an app leaves the active workspace, and "Hide panels" steps out of it until panels show
  again.
- Removing a workspace floats its panels rather than closing them.
- While a workspace covers it, the graph and canvas background stop rendering.

### `zen.workspaces`

| Call                   | Meaning                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| `list()`               | `{ id, name }[]` in switcher order.                                                         |
| `current()`            | The workspace on screen, or `null` for the graph.                                           |
| `create(name?)`        | Add one (named "Workspace <n>" by default); returns its id. It isn't shown.                 |
| `activate(id \| null)` | Show it, or the graph with `null`. Unknown ids are ignored.                                 |
| `rename(id, name)`     | Rename.                                                                                     |
| `remove(id)`           | Remove; its panels float. The last workspace can't be removed.                              |
| `tile(panelId)`        | Tile an open panel into the current workspace (or the last one shown) and show it.          |
| `onChange(cb)`         | `cb(current)` when workspaces are added, removed, renamed or switched. Returns unsubscribe. |

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
      id: 'status', // becomes 'myplugin:status'
      label: 'My status',
      icon: 'mdi mdi-circle',
      order: 50,
      render: mountVue(Status),
    },
  ],
})
```

| Field        | Meaning                                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`         | Unique. A short id gets your plugin prefix (`status` → `myplugin:status`); an id containing `:` is kept. Re-registering an id replaces it. |
| `label`      | Name in Zen Settings.                                                                                                                      |
| `icon`       | Icon in Zen Settings.                                                                                                                      |
| `order`      | Position hint, lower is further left. Used only when the widget is first seen; the user's order wins after that.                           |
| `defaultOn`  | Shown by default (default `true`).                                                                                                         |
| `render(el)` | Fill the slot; return cleanup.                                                                                                             |

Low level: `window.ZenKit.taskbar.register(widget)` returns an unregister function; it takes the
id as given, with no prefix. Built-ins: `zenkit:run` (80), `zenkit:jobs` (90),
`zenkit:hide-panels` (100), `zenkit:canvas-controls` (110).

Through `registerZenPlugin`, panel, taskbar-widget and capability ids get your plugin prefix
automatically; channel, theme and background ids never do (they are shared on purpose).
