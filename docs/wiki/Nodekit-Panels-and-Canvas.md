# Nodekit panels and canvas

nodekit helpers that reach outside the widget body: popping a widget into a ZenKit panel, the
shared viewer, title-bar buttons, slot links, mounting widgets by hand, and drags inside node
bodies. The ZenKit ones talk to `window.ZenKit` directly (no `@nynxz/zenkit-client` import) and
degrade when ZenKit is missing.

| Helper                                                 | Without ZenKit                             |
| ------------------------------------------------------ | ------------------------------------------ |
| `openZenPanel`                                         | Returns `null`; you show your own fallback |
| `hasZenPanels`                                         | `false`                                    |
| `openViewer`                                           | Opens the item in a new tab                |
| `registerSlotLink` / `slotLinks`                       | No-op                                      |
| `addNodeHeaderButton`, `mountWidget`, `useDragSurface` | Work the same (plain ComfyUI)              |

## openZenPanel and hasZenPanels

Open a Vue component in a dockable ZenKit panel.

```ts
import { hasZenPanels, openZenPanel } from '@/framework'
import LoraDetail from './LoraDetail.vue'

function showDetails(name: string) {
  const handle = openZenPanel(
    {
      id: `nynxz:lora:${name}`,
      title: name,
      icon: 'mdi mdi-information-outline',
      width: 560,
      height: 720,
      persist: false,
      props: { name },
    },
    LoraDetail,
  )
  if (!handle) modalOpen.value = true // no ZenKit: fall back to a ZenModal
}

const canPopOut = hasZenPanels() // decide before rendering, so nothing flashes
```

```ts
openZenPanel(spec: ZenPanelSpec, component: Component): ZenPanelHandle | null
hasZenPanels(): boolean
```

`ZenPanelSpec`:

| Field                                      | Type                       | Description                                                                                                    |
| ------------------------------------------ | -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `id`                                       | `string`                   | Stable id. Opening the same id again focuses the existing panel.                                               |
| `title`                                    | `string`                   |                                                                                                                |
| `icon`                                     | `string?`                  | Full MDI class, e.g. `'mdi mdi-cog'`                                                                           |
| `width`, `height`, `minWidth`, `minHeight` | `number?`                  | px                                                                                                             |
| `persist`                                  | `boolean?`                 | Remember geometry across reloads (ZenKit default `true`)                                                       |
| `props`                                    | `Record<string, unknown>?` | Passed to the component **by value at open time**. For live state pass a reactive object or callbacks.         |
| `onClose`                                  | `() => void`               | Called once when the panel closes, by its own close button or by `handle.close()`. Unreleased, not yet on npm. |

`ZenPanelHandle`:

| Method                             | Description                                                                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `close(opts?: { keep?: boolean })` | Close. `keep: true` remembers its place (geometry, workspace tile) for the next open of the same id. `opts` is unreleased, not yet on npm. |
| `setTitle(title)`                  |                                                                                                                                            |
| `focus()`                          | Bring to front and restore if minimized. Unreleased, not yet on npm.                                                                       |

nodekit creates the Vue app inside the panel and unmounts it when the panel closes. It returns
`null` when ZenKit is absent or `panels.open` throws.

> Note: `hasZenPanels()` is synchronous and does not wait for ZenKit to finish installing
> (`window.ZenKitPending` / `zen:ready`). A widget that mounts during workflow load can see
> `false` even though ZenKit is about to arrive; the popout pattern below retries for that reason.

### The popout pattern

NynxzNodes (H3 Studio) and ZenCut use the same pattern to pop a large editor out of its node:

- The panel mounts the **same component** again with `panel: true`, sharing the widget.
- The node remembers it is popped out in `node.properties`, so it reopens after a reload.
- The panel id includes the graph id and node id, so ZenKit restores its size and workspace tile.
- When the node leaves (workflow switched or node deleted), the panel closes with `keep: true` and
  the node's "popped" flag is left set.

```ts
// ZenCut frontend/widgets/ZenCut.vue (abridged)
const props = defineProps<{ widget?: DOMWidget; node?: CutNode; panel?: boolean }>()
const nodeId = String(props.node?.id ?? '')
const POPPED = 'zencutPoppedOut'
const handles = new WeakMap<object, ZenPanelHandle>()
const quiet = new WeakSet<object>() // panels closed because the node left
const panelId = () => {
  const graph = props.node?.graph?.id
  return graph ? `zencut:${graph}:${nodeId}` : `zencut.${nodeId}`
}
function remember(popped: boolean) {
  const node = props.node
  if (!node) return
  node.properties ??= {}
  if (Boolean(node.properties[POPPED]) === popped) return
  node.properties[POPPED] = popped
  node.graph?.change?.() // mark the workflow modified
}

const self = getCurrentInstance()!.type // the panel mounts this component again
function popOut() {
  const node = props.node
  const handle = openZenPanel(
    {
      id: panelId(),
      title: 'ZenCut',
      icon: 'mdi mdi-movie-edit-outline',
      width: 1180,
      height: 780,
      minWidth: 760,
      minHeight: 520,
      persist: true,
      props: { widget: props.widget, node: props.node, panel: true },
      onClose: () => {
        if (node) handles.delete(node)
        if (node && quiet.delete(node)) return // node left: keep "popped" for next load
        remember(false) // user closed it
      },
    },
    self,
  )
  if (!handle || !node) return
  handles.set(node, handle)
  remember(true)
  const previous = node.onRemoved
  node.onRemoved = function (...args) {
    const h = handles.get(node)
    if (h) {
      quiet.add(node)
      h.close({ keep: true })
    }
    return previous?.apply(this, args)
  }
}

onMounted(() => {
  if (props.panel || !props.node?.properties?.[POPPED]) return
  let tries = 0 // ZenKit may install after this node mounts
  const attempt = () => {
    if (isPanelOpen(nodeId) || (props.node && handles.has(props.node))) return
    if (hasZenPanels()) popOut()
    else if (++tries < 40) setTimeout(attempt, 250) // up to 10 s
  }
  attempt()
})
```

While popped out, the in-node instance renders a placeholder ("ZenCut is open in a panel" with a
"Show it" button). Which nodes are popped is tracked in a small reactive `Set` keyed by node id
(`lib/panel.ts`); the panel instance adds itself on mount and removes itself on unmount. The two
instances share state through a composable keyed on the widget (`useEdit(props.widget)`).

## openViewer

Open media in ZenKit's shared fullscreen viewer.

```ts
import { openViewer, viewUrl } from '@nynxz/zenkit-nodekit'

openViewer(
  images.map((r) => ({ src: viewUrl(r), label: r.filename })),
  clickedIndex,
)
```

```ts
openViewer(items: ViewerItem[], index = 0): void
interface ViewerItem { src: string; kind?: 'image' | 'video'; label?: string; meta?: string }
```

Without ZenKit (or if the viewer throws) it opens `items[index].src` in a new tab.

> Note: this differs from `@nynxz/zenkit-client`'s `openViewer(items, opts)`, which returns a
> handle and accepts `kind: 'audio'`.

## addNodeHeaderButton

Put a button (typically a settings cog) in the node's title bar, on both renderers.

```ts
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { addNodeHeaderButton, type NodeHeaderButtonHandle } from '@/framework'

const root = ref<{ el: HTMLElement | null } | null>(null) // a ZenWidget ref
const showOpts = ref(false)
let cog: NodeHeaderButtonHandle | null = null

onMounted(() => {
  cog = addNodeHeaderButton(props.node, root.value?.el ?? null, {
    icon: 'mdi mdi-cog',
    text: '⚙',
    title: 'Compare controls',
    onClick: () => (showOpts.value = !showOpts.value),
  })
  cog.setActive(showOpts.value)
})
watch(showOpts, (v) => cog?.setActive(v))
onBeforeUnmount(() => cog?.destroy())
```

```ts
addNodeHeaderButton(node: unknown, widgetEl: HTMLElement | null, opts: NodeHeaderButtonOptions): NodeHeaderButtonHandle
```

| Option        | Type         | Description                                                                         |
| ------------- | ------------ | ----------------------------------------------------------------------------------- |
| `icon`        | `string`     | Icon class for the Nodes 2.0 DOM header, including the base class (`'mdi mdi-cog'`) |
| `text`        | `string?`    | Glyph for the Nodes 1.0 canvas title button (default `'⚙'`)                         |
| `title`       | `string?`    | Tooltip                                                                             |
| `onClick`     | `() => void` |                                                                                     |
| `activeColor` | `string?`    | Background of the active state on the canvas button                                 |

Handle: `setActive(on: boolean)`, `destroy()`.

`widgetEl` is any element inside the node body; the DOM header is found by walking up from it. The
DOM button re-attaches every 500 ms because a renderer switch recreates the header. Presses on it
don't drag the node or start a title rename.

## Slot links

Middle-click a node's slot to spawn a companion node and wire it. Declare them in `nodeDef` or
`defineNode`; `registerNodes` registers one per class in `is`.

```ts
export const nodeDef: Omit<NodeDef, 'widgets'> = {
  is: 'nynxz.H3.Studio',
  slotLinks: [
    { input: 'setup', spawn: 'nynxz.H3.StudioSetup' },
    { output: 'render', spawn: 'nynxz.H3.StudioOutputs' },
  ],
}
```

`SlotLinkDef`: exactly one of `input` / `output` (slot name), plus `spawn` (node id to create).

The underlying call is also exported:

```ts
registerSlotLink(spec: { on: { node: string; input?: string; output?: string }; spawn: string }): void
```

> Note: nodekit waits up to 6 s for ZenKit (`zen:ready` or `ZenKit.ready`) and does not honour
> `window.ZenKitPending`. If ZenKit installs later than that, slot links silently never register.
> `@nynxz/zenkit-client`'s `registerSlotLink` waits properly and returns an unregister function.

## mountWidget

Mount a Vue component as a DOM widget on a node. `registerNodes` calls it for you; call it directly
only for nodes without a Python class or for custom wiring.

```ts
// NynxzNodes frontend/groupSwitcher/register.ts (a frontend-only, virtual node)
onAdded() {
  if (this.#mounted) return
  this.#mounted = true
  mountWidget(this as never, {
    widgetName: 'switcher',
    widgetType: 'NYNXZ_GROUP_SWITCHER',
    component: GroupSwitcher,
    defaultValue: { ...DEFAULT_SETTINGS },
  })
}
```

```ts
mountWidget(node, opts: MountOptions): { widget: DOMWidget }   // the createNodekit-bound form
```

| Option         | Type                       | Description                                                                                                                                         |
| -------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `widgetName`   | `string`                   | Widget name (serialised key)                                                                                                                        |
| `widgetType`   | `string`                   | io type                                                                                                                                             |
| `component`    | `Component`                | Receives `{ widget, node, ...props }`                                                                                                               |
| `minHeight`    | `number?`                  |                                                                                                                                                     |
| `minWidth`     | `number?`                  | Patches `computeSize` (canvas) and the node element's `min-width` (Vue nodes)                                                                       |
| `defaultValue` | `unknown`                  |                                                                                                                                                     |
| `serialize`    | `boolean?`                 | Default `true`                                                                                                                                      |
| `fill`         | `boolean?`                 | Stretch to the node body and stay resizable instead of auto-growing                                                                                 |
| `dragThrough`  | `boolean?`                 | Body ignores pointer events so presses drag the node                                                                                                |
| `props`        | `Record<string, unknown>?` | Extra props merged over `{ widget, node }`. For a widget on node A that must read and write node B (subgraph promotion: pass `{ node: interior }`). |

What it handles for you:

- Value: `getValue`/`setValue` are closure-backed, so the value serialises with the graph.
- Size: auto-grows via a `ResizeObserver` and `getMinHeight`; `fill` switches that off. A child with
  `data-zen-spacer` pushes a footer to the bottom.
- Pointer guard: presses on `button, input, select, textarea, a[href], [contenteditable], [data-zen-drag]`
  and the ARIA roles `button, slider, switch, tab, combobox, checkbox` don't start a node drag.
- `serialize: false`: ComfyUI ignores `options.serialize` for DOM widgets, so nodekit sets the
  top-level `widget.serialize = false` and returns the light default from `getValue`.
- Undo/redo rebuilds every node with the same id; nodekit reclaims the reused Vue-nodes host so the
  body does not go blank.

For a frontend-only node, also: mount in `onAdded` (a loaded workflow writes saved values right
after), set `isVirtualNode = true` to keep it out of the prompt, set `category` **after**
`LiteGraph.registerNodeType` (it derives category from a `/` in the type and wipes yours), and fix
the display name in `beforeRegisterVueAppNodeDefs`.

> Note: Group Switcher hard-codes `widgetType: 'NYNXZ_GROUP_SWITCHER'` instead of
> `typeId('GroupSwitcher')`.

## useDragSurface

Pointer drags inside a node body (scrub bars, wipe handles, reorder grips) that survive canvas zoom
and don't turn into node drags. HTML5 drag-and-drop is a poor fit here: the native drag ghost
renders at the wrong scale inside the transformed node body.

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { useDragSurface } from '@/framework'

const pos = ref(0.5)
let grabbed = 0
const drag = useDragSurface({
  onStart: () => {
    grabbed = pos.value
  },
  onMove: (ctx) => {
    pos.value = Math.min(1, Math.max(0, grabbed + ctx.deltaRatio.x))
  },
  onEnd: () => commit(), // persist once, not on every move
})
</script>

<template>
  <div class="wipe" data-zen-drag :ref="drag.el" v-bind="drag.handlers">
    <div class="handle" :style="{ left: pos * 100 + '%' }" />
  </div>
</template>

<style scoped>
.wipe {
  touch-action: none;
  user-select: none;
}
.wipe > * {
  pointer-events: none;
}
</style>
```

```ts
useDragSurface(opts: DragSurfaceOptions): DragSurface
```

| Option    | Type                       | Description                                                          |
| --------- | -------------------------- | -------------------------------------------------------------------- |
| `onStart` | `(ctx) => boolean \| void` | Press landed. Return `false` to ignore it (nothing grabbable there). |
| `onMove`  | `(ctx) => void`            | Required                                                             |
| `onEnd`   | `(ctx) => void`            | Released, cancelled or capture lost. Commit here.                    |

| Returned   | Type                                        | Description                                                                |
| ---------- | ------------------------------------------- | -------------------------------------------------------------------------- |
| `el`       | `Ref<HTMLElement \| null>`                  | Bind with `:ref="drag.el"`                                                 |
| `handlers` | `Record<string, (e: PointerEvent) => void>` | Spread with `v-bind`; covers down, move, up, cancel and lostpointercapture |
| `dragging` | `Ref<boolean>`                              |                                                                            |

`DragContext`:

| Field        | Description                                                                                                 |
| ------------ | ----------------------------------------------------------------------------------------------------------- |
| `ratio`      | Pointer position in the surface, 0..1 per axis. Zoom-immune.                                                |
| `deltaRatio` | Movement since press as a fraction of the surface. Pair with `ratio`.                                       |
| `delta`      | Movement since press in element-space px (zoom divided out). For real units. Do not divide by `rect.width`. |
| `rect`       | Live bounding rect (screen space)                                                                           |
| `event`      | The `PointerEvent`                                                                                          |

The component supplies the CSS: `data-zen-drag`, `touch-action: none`, `user-select: none`, and
`pointer-events: none` on children. Drive state from the value at press plus the delta, not from
the absolute pointer position.
