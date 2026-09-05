# @nynxz/zenkit-nodekit

Everything a ComfyUI custom-node pack's **frontend** needs: the build, the ambient host types,
and the machinery to put a Vue component inside a node body.

It knows nothing about ZenKit being installed. Panels and the viewer light up when the ZenKit
runtime is present and no-op when it isn't, so a pack built on nodekit works on a plain ComfyUI.

## Install

```sh
pnpm add -D @nynxz/zenkit-nodekit
pnpm add @nynxz/zenkit-ui       # optional: the themed component set
```

## The three files

**1. `pack.json`** — your pack's identity, read by both halves so they can't drift.

```json
{ "namespace": "nynxz", "displayName": "Nynxz's Nodes", "category": "Nynxz" }
```

**2. `src/framework.ts`** — bind nodekit once; every other file imports from here.

```ts
import { createNodekit, defineNode } from '@nynxz/zenkit-nodekit'
import manifest from '../pack.json'

export const { nodeId, typeId, route, registerNodes, discoverWidgets, widgetTypes } =
  createNodekit(manifest)
export { defineNode }
```

**3. `src/main.ts`** — the whole registration story.

```ts
const widgets = import.meta.glob('./widgets/*.vue', { eager: true })
registerNodes(discoverWidgets(widgets))
```

`vite.config.mts` is then three lines:

```ts
import { zenPluginConfig } from '@nynxz/zenkit-nodekit/vite'
export default zenPluginConfig({ name: 'comfyui-yourpack', configUrl: import.meta.url })
```

and `tsconfig.json` extends `@nynxz/zenkit-nodekit/tsconfig.pack.json`, adding
`node_modules/@nynxz/zenkit-nodekit/comfy.d.ts` to `include` for the ambient `@comfy/*` types.

## Adding a widget is adding a file

Drop `src/widgets/LoraStack.vue` in. It registers the io type `NYNXZ_LORA_STACK` —
`namespace` uppercased, plus the component name in SCREAMING_SNAKE.

Your python schema derives the _same_ string from the _same_ component name, so neither side
writes it out:

```python
LoraStackType = widget_type("LoraStack", list)      # -> NYNXZ_LORA_STACK
...
inputs=[LoraStackType.Input("stack", default=[])]
```

The component receives `{ widget, node }`. `widget.value` is what serializes into the prompt:

```vue
<script setup lang="ts">
import type { DOMWidget } from '@nynxz/zenkit-nodekit'
const props = defineProps<{ widget: DOMWidget; node: unknown }>()
const { widget } = props // destructure before writing; see the constraints below
</script>
```

Two constraints:

- Take `widget` out of `props` before writing to it — assigning through `props.widget` trips
  `vue/no-mutating-props`.
- `widget.value` is not reactive. Hold state in a `ref` and write through on change.

The widget's name and default come from what ComfyUI passes the constructor, so both live only
in `define_schema`.

## When a widget needs more

Export `widgetOptions` for widget-level tweaks, or `nodeDef` for node-level behaviour —
colocated with the component instead of in a separate registry:

```vue
<script lang="ts">
import type { WidgetOptions } from '@nynxz/zenkit-nodekit'
export const widgetOptions: WidgetOptions = { minHeight: 90, fill: true }
</script>
```

```ts
// node-level: needs `is`, because these act on a node instance
export const nodeDef = {
  is: ['nynxz.Lora.Loader', 'nynxz.Lora.LoaderCLIP'],
  minSize: [380, 130] as [number, number],
  output: { widget: 'stack', from: (o) => o.result?.[0] },
}
```

To declare nodes explicitly instead of by convention, `defineNode` + `discoverNodes` take a
glob of `node.ts` files. Both paths end in `registerNodes`.

## Also exported

|                                 |                                                                            |
| ------------------------------- | -------------------------------------------------------------------------- |
| `mountWidget`                   | mount a Vue app in a node body — pointer, sizing and value traps handled   |
| `useDragSurface`                | drag-to-reorder inside a node body without the canvas stealing the gesture |
| `addNodeHeaderButton`           | a control in the node's title bar                                          |
| `openZenPanel` / `hasZenPanels` | pop a component into a real dockable panel when ZenKit is installed        |
| `openViewer` / `viewUrl`        | the shared media viewer                                                    |
| `registerSlotLink`              | middle-click a slot → spawn and wire a companion node                      |
