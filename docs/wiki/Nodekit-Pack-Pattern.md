# Nodekit pack pattern

`@nynxz/zenkit-nodekit` is how a ComfyUI node pack puts Vue components inside node bodies. A
widget is one `.vue` file; its filename decides the io type the Python schema refers to. The pack
works on plain ComfyUI and picks up extras (popout panels, slot links, the shared viewer) when
ZenKit is installed.

This page follows what ComfyUI-NynxzNodes and ComfyUI-ZenCut actually do. See also
[Nodekit media](Nodekit-Media.md) and [Nodekit panels and canvas](Nodekit-Panels-and-Canvas.md).

## Minimal pack

Five frontend files and two Python files give you one node with a Vue body.

```json
// pack.json
{ "namespace": "zencut", "displayName": "ZenCut", "category": "ZenCut" }
```

```ts
// frontend/framework.ts — the pack's one import of nodekit
import { createNodekit, defineNode, type WidgetOptions, type NodeDef } from '@nynxz/zenkit-nodekit'
import manifest from '../pack.json'

export const {
  NAMESPACE,
  DISPLAY_NAME,
  nodeId,
  typeId,
  route,
  settingId,
  registerNodes,
  discoverNodes,
  discoverWidgets,
  widgetTypes,
  mountWidget,
  addNodeHeaderButton,
  mediaLibrary,
} = createNodekit(manifest)
export { defineNode }
export type { WidgetOptions, NodeDef }
```

```ts
// frontend/main.ts
import '@nynxz/zenkit-ui/style.css'
import '@nynxz/zenkit-ui/comfy-bridge.css'
import { DISPLAY_NAME, discoverWidgets, registerNodes, widgetTypes } from '@/framework'

const widgets = import.meta.glob('./widgets/*.vue', { eager: true })
registerNodes(discoverWidgets(widgets))
console.log(`[${DISPLAY_NAME}] widgets: ${widgetTypes(widgets).join(', ')}`)
```

```vue
<!-- frontend/widgets/ZenCut.vue  ->  io type ZENCUT_ZEN_CUT -->
<script lang="ts">
import type { NodeDef, WidgetOptions } from '@/framework'
export const widgetOptions: WidgetOptions = {
  name: 'edit',
  fill: true,
  minHeight: 560,
  default: {},
}
export const nodeDef: Omit<NodeDef, 'widgets'> = { is: 'zencut.Edit', minSize: [980, 680] }
</script>

<script setup lang="ts">
const props = defineProps<{
  widget?: { value: unknown; callback?: (v: unknown) => void }
  node?: unknown
}>()
</script>

<template><div>…</div></template>
```

```python
# nodes/cut/node.py
from comfy_api.latest import io
from .._lib.io_types import widget_type

EditType = widget_type("ZenCut", dict)            # -> ZENCUT_ZEN_CUT

class ZenCutEdit(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id="zencut.Edit", display_name="ZenCut", category="ZenCut",
                         inputs=[EditType.Input("edit")],
                         outputs=[io.Video.Output(display_name="video")])
```

```python
# __init__.py
from .nodes import comfy_entrypoint  # noqa: F401
WEB_DIRECTORY = "./web"
```

Plus `vite.config.mts`, `tsconfig.json` and `package.json`, covered under [Build setup](#build-setup).

## Project layout

Both real packs use the same shape:

```
pack.json                   identity: namespace, displayName, category
package.json                nodekit (dev) + zenkit-ui (dep)
pnpm-workspace.yaml         link: overrides for local ZenKit development
vite.config.mts             zenPluginConfig({ srcDir: './frontend', outDir: 'web' })
tsconfig.json
__init__.py                 V3: re-exports comfy_entrypoint; WEB_DIRECTORY = "./web"
nodes/__init__.py           ComfyExtension + comfy_entrypoint, autodiscovers node modules
nodes/_lib/io_types.py      widget_type(), inline_widget(), widget_io_type()
nodes/_lib/autodiscover.py  imports every non-underscore module, collects io.ComfyNode classes
nodes/_lib/media_api.py     /<ns>/media routes (see Nodekit media)
frontend/framework.ts       createNodekit(manifest), re-exports
frontend/main.ts            glob widgets -> registerNodes
frontend/widgets/*.vue      one file = one widget io type
frontend/nodes/*.ts         optional: explicit defineNode() modules
web/                        build output (gitignored, built in CI)
```

> Note: the nodekit README uses `src/` and `js/` (the `zenPluginConfig` defaults). Both real
> packs use `frontend/` and `web/` by passing `srcDir` and `outDir`.

## pack.json and identity

`pack.json` holds the pack's identity. `createNodekit(manifest)` derives every id from it, so node
ids, io types, routes and setting keys agree.

| Field         | Used for                                                                               |
| ------------- | -------------------------------------------------------------------------------------- |
| `namespace`   | Node-id prefix, io-type prefix, route prefix, extension name. Dots nest (`acme.labs`). |
| `displayName` | Console messages                                                                       |
| `category`    | Root menu category, exposed as `CATEGORY`                                              |

| Identity member                               | `namespace: "nynxz"` gives                |
| --------------------------------------------- | ----------------------------------------- |
| `NAMESPACE`, `DISPLAY_NAME`, `CATEGORY`       | the manifest values                       |
| `ROUTE_PREFIX`                                | `/nynxz` (`acme.labs` gives `/acme/labs`) |
| `nodeId('Image.Compare')`                     | `nynxz.Image.Compare`                     |
| `typeId('LoraStack')`, `typeId('LORA_STACK')` | `NYNXZ_LORA_STACK`                        |
| `route('media')`                              | `/nynxz/media` (no `api.apiURL` prefix)   |
| `settingId('SaveImage.BaseDirectory')`        | `nynxz.SaveImage.BaseDirectory`           |

`createNodekit` is a factory rather than a `configure()` call because widget modules call
`nodeId()` while they are being evaluated, before `main.ts` runs. Keep it in one
`framework.ts` and import from `@/framework` everywhere else.

> Note: the nodekit README says pack.json is "read by both halves". In both real packs the
> Python side does not read it. The namespace, `WIDGET_IO_PREFIX`, route strings and category are
> repeated in Python (`nodes/_base.py`, `nodes/_lib/io_types.py`, `nodes/_lib/media_api.py`). Keep
> them in sync by hand.

## createNodekit

```ts
createNodekit(pack: PackManifest): Nodekit
```

`Nodekit` is the `Identity` above plus these bound helpers:

| Member                | Signature                                             | Purpose                                                                                                                                      |
| --------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `registerNodes`       | `(defs: NodeDef[], extensionName?: string) => void`   | Register every def as one ComfyUI extension (name defaults to `NAMESPACE`)                                                                   |
| `discoverWidgets`     | `(modules: Record<string, unknown>) => NodeDef[]`     | Turn a `widgets/*.vue` glob into defs by filename                                                                                            |
| `discoverNodes`       | `(modules: Record<string, unknown>) => NodeDef[]`     | Flatten a glob of modules that default-export a `NodeDef` or `NodeDef[]`                                                                     |
| `widgetTypes`         | `(modules) => string[]`                               | The io types a widget glob registers, sorted                                                                                                 |
| `mountWidget`         | `(node, opts: MountOptions) => { widget: DOMWidget }` | Mount a component in a node body yourself ([details](Nodekit-Panels-and-Canvas.md#mountwidget))                                              |
| `addNodeHeaderButton` | `(node, widgetEl, opts) => NodeHeaderButtonHandle`    | A button in the node title bar ([details](Nodekit-Panels-and-Canvas.md#addnodeheaderbutton))                                                 |
| `mediaLibrary`        | `MediaLibrary`                                        | Lists ComfyUI's media folders through the pack's `/<ns>/media` route ([details](Nodekit-Media.md#medialibrary)). Unreleased, not yet on npm. |

Identity-free exports (`defineNode`, `useDragSurface`, `viewUrl`, `openZenPanel`,
`hasZenPanels`, `openViewer`, `registerSlotLink`, the media-ref helpers) are imported directly and
usually re-exported from `framework.ts`.

> Note: `discoverWidgets` and `widgetTypes` exist only on the `createNodekit` result; the unbound
> functions are not exported from the package.

## Widgets by filename

`discoverWidgets` turns each file in the glob into one `NodeDef`:

1. The file name becomes the component name: `widgets/LoraStack.vue` gives `LoraStack`.
2. `typeId(name)` gives the io type: `NYNXZ_LORA_STACK`.
3. The def is `{ ...nodeDef, widgets: [{ type, component: default, ...widgetOptions }] }`.

Files are processed in path order. A file without a default export, or a second file mapping to
the same io type, is skipped with a console warning.

One file gives one node def. When a second node reuses the same widget type, declare it with
`defineNode` in a separate glob (NynxzNodes uses `frontend/nodes/*.ts`):

```ts
// frontend/nodes/previewImage.ts
import { defineNode, typeId } from '@/framework'
import SavePreview, { widgetOptions } from '@/widgets/SavePreview.vue'

export default defineNode({
  is: 'nynxz.Preview.Image',
  minSize: [300, 320],
  hideOutputImages: true,
  widgets: [{ ...widgetOptions, type: typeId('SavePreview'), component: SavePreview }],
})
```

```ts
// frontend/main.ts
const widgets = import.meta.glob('./widgets/*.vue', { eager: true })
const extraNodes = import.meta.glob('./nodes/*.ts', { eager: true })
registerNodes([...discoverWidgets(widgets), ...discoverNodes(extraNodes)])
```

> Note: the nodekit README calls these "`node.ts` files" and nodekit's own comments say
> "`widget.ts`" modules and `framework/discovery.py`. Neither exists in the real packs; any glob of
> modules that default-export `defineNode(...)` works.

## Widget io type naming

The io type is a plain string shared by both halves. TypeScript derives it from the filename;
Python derives it from the same component name.

| Component name | io type (namespace `nynxz`) |
| -------------- | --------------------------- |
| `LoraStack`    | `NYNXZ_LORA_STACK`          |
| `H3Studio`     | `NYNXZ_H3_STUDIO`           |
| `SavePreview`  | `NYNXZ_SAVE_PREVIEW`        |

Rule: `NAMESPACE.toUpperCase()` with `.` and `-` replaced by `_`, then `_`, then the name in
SCREAMING_SNAKE_CASE (`([a-z0-9])([A-Z])` and `([A-Z]+)([A-Z][a-z])` get an underscore).

### Python helper

nodekit ships no Python. Each pack carries its own `nodes/_lib/io_types.py`; NynxzNodes and ZenCut
have identical copies apart from the prefix:

```python
WIDGET_IO_PREFIX = "ZENCUT_"   # hard-coded; keep it equal to the namespace

def widget_io_type(component_name: str) -> str:
    """Mirror of nodekit's typeId(): "LoraStack" -> "ZENCUT_LORA_STACK"."""
    snake = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", component_name)
    snake = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1_\2", snake)
    return WIDGET_IO_PREFIX + snake.upper()

def widget_type(component_name: str, value_type: type, doc: str | None = None):
    io_type = widget_io_type(component_name)

    @io.comfytype(io_type=io_type)
    class _Type:
        Type = value_type
        Input = widget_input()      # socketless io.WidgetInput subclass
    ...
    return _Type
```

| Helper                                    | Use                                                                                                                                                                                       |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `widget_type(name, value_type, doc=None)` | Declare a socketless widget input bound to `widgets/<name>.vue`. Use `.Input(id, default=…)` in the schema.                                                                               |
| `inline_widget(inp, name)`                | Keep a normal input's socket type but draw it with `widgets/<name>.vue` (sets `extra_dict["widgetType"]`). Do not use `io.WidgetInput(widget_type=…)`: that replaces the socket type too. |
| `advanced(inp)`                           | Mark an input advanced via `extra_dict` (concrete Input classes don't forward `extra_dict` as a kwarg).                                                                                   |
| `widget_io_type(name)`                    | The raw string                                                                                                                                                                            |

The socketless input drops `tooltip`, because ComfyUI would show it over the whole node body.

> Note: the io type is a bare string contract. If the two sides disagree, no widget renders and the
> prompt fails with "Required input is missing". NynxzNodes runs
> `scripts/check_widget_contract.py` in `pnpm check` to diff `widget_type("X"` /
> `inline_widget(…, "X")` calls against `frontend/widgets/*.vue`. ZenCut has no such check.

## The widget component contract

`registerNodes` mounts each widget with `mountWidget`, which creates a Vue app with two props:

| Prop     | Type               | Notes                                                              |
| -------- | ------------------ | ------------------------------------------------------------------ |
| `widget` | `DOMWidget`        | `widget.value` is what serialises into the workflow and the prompt |
| `node`   | the LiteGraph node | For `node.id`, `node.graph`, `node.properties`, …                  |

`widget.value` is **not reactive**. Keep state in Vue reactivity and write it through, calling
`widget.callback` so ComfyUI notices. ZenCut's `useEdit`:

```ts
export function useEdit(widget: DOMWidget | undefined) {
  const edit = reactive(toEdit(widget?.value))
  if (widget)
    effectScope(true).run(() =>
      watch(
        edit,
        () => {
          const value = JSON.parse(JSON.stringify(edit))
          widget.value = value
          try {
            widget.callback?.(value)
          } catch {
            /* no callback */
          }
        },
        { deep: true },
      ),
    )
  return edit
}
```

> Note: the nodekit README says to destructure `widget` from props before writing (to satisfy
> `vue/no-mutating-props`). The real packs pass `props.widget` into a composable instead, and they
> declare a local `interface DOMWidget { value; callback? }` with `widget` optional rather than
> importing nodekit's `DOMWidget`. Either works at runtime.

The widget's input name and default come from the Python schema unless `widgetOptions` overrides
them.

## widgetOptions and nodeDef

A widget file can export two extra things from a plain `<script lang="ts">` block (module scope,
beside `<script setup>`):

```ts
// NynxzNodes frontend/widgets/ImageCompare.vue
export const widgetOptions: WidgetOptions = {
  name: 'compare_view',
  minHeight: 200,
  fill: true,
  serialize: false, // preview URLs go stale on restart
  default: { beforeImages: [], afterImages: [] },
}
export const nodeDef: Omit<NodeDef, 'widgets'> = {
  is: 'nynxz.Image.Compare',
  minSize: [440, 360],
  output: {
    widget: 'compare_view',
    from: (o) => ({
      beforeImages: (o.a_images ?? []).map(viewUrl),
      afterImages: (o.b_images ?? []).map(viewUrl),
    }),
  },
}
```

### WidgetOptions

`WidgetOptions` is `NodeWidgetDef` without `type` and `component`.

| Option        | Type      | Default                     | Description                                                                                                |
| ------------- | --------- | --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `name`        | `string`  | the Python input id         | Widget name. `output.widget` must match it.                                                                |
| `minHeight`   | `number`  | —                           | Minimum body height in px                                                                                  |
| `minWidth`    | `number`  | —                           | Narrowest the node may be resized to                                                                       |
| `fill`        | `boolean` | `false`                     | Stretch to fill the node body (stays user-resizable) instead of growing to fit content                     |
| `dragThrough` | `boolean` | `false`                     | Visual-only body: presses fall through to drag the node. Interactive children need `pointer-events: auto`. |
| `serialize`   | `boolean` | `true`                      | `false` for transient values such as run results                                                           |
| `default`     | `unknown` | the Python schema `default` | Initial value                                                                                              |

### NodeDef

| Field              | Type                                            | Description                                                                                                                               |
| ------------------ | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `is`               | `string \| string[]`                            | `comfyClass` / V3 `node_id` this applies to. An array shares one def across node classes. Optional: widgets register globally by io type. |
| `minSize`          | `[number, number]`                              | Floor applied on create: `setSize(max(current, min))`                                                                                     |
| `hideOutputImages` | `boolean`                                       | Hide ComfyUI's default image strip                                                                                                        |
| `widgets`          | `NodeWidgetDef[]`                               | Widgets to mount. Each io type registers once (first declaration wins).                                                                   |
| `output`           | `{ widget: string; from: (output) => unknown }` | On execute, map the node's `ui` output into the widget via its `callback`. Python side: `io.NodeOutput(..., ui=...)`.                     |
| `slotLinks`        | `SlotLinkDef[]`                                 | `{ input?, output?, spawn }`: middle-click that slot to spawn and wire `spawn`. ZenKit only.                                              |
| `settings`         | `Record<string, unknown>[]`                     | ComfyUI settings merged into the extension. Build ids with `settingId()`.                                                                 |

`defineNode(def)` returns `def` unchanged; it exists for typing.

> Note: `output` never assigns `widget.value`. DOM widgets ignore `serialize: false` in ComfyUI,
> so writing the value would persist run results into the workflow. nodekit calls
> `widget.callback(value)` instead; your component handles it.

## Python registration (V3)

Both packs register through `comfy_entrypoint` and an autodiscovering extension:

```python
# nodes/__init__.py
from comfy_api.latest import ComfyExtension, io
from ._lib import media_api  # noqa: F401  (registers /zencut/media* routes on import)
from ._lib.autodiscover import load_nodes

class ZenCutExtension(ComfyExtension):
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return load_nodes(__name__, list(__path__))

async def comfy_entrypoint() -> ComfyExtension:
    return ZenCutExtension()
```

`load_nodes` imports every module under `nodes/` whose name does not start with `_`, collects the
`io.ComfyNode` subclasses defined there, skips abstract bases, logs (does not raise) import errors,
and de-duplicates by `node_id`.

**V3 gotcha:** expose `comfy_entrypoint` and never also define `NODE_CLASS_MAPPINGS`. ComfyUI
checks for `NODE_CLASS_MAPPINGS` first and returns early, so `comfy_entrypoint` is never called and
nothing registers.

## Build setup

### vite.config.mts

```ts
import { zenPluginConfig } from '@nynxz/zenkit-nodekit/vite'

export default zenPluginConfig({
  name: 'comfyui-zencut',
  configUrl: import.meta.url,
  srcDir: './frontend',
  outDir: 'web', // matches WEB_DIRECTORY in __init__.py
})
```

| Option          | Default             | Description                                                                                                                                                           |
| --------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`          | required            | Pack name; also the `data-extension` attribute on the injected `<style>`                                                                                              |
| `configUrl`     | required            | Always `import.meta.url`                                                                                                                                              |
| `srcDir`        | `'./src'`           | Frontend source; `@` aliases to it                                                                                                                                    |
| `entry`         | `${srcDir}/main.ts` | Entry file                                                                                                                                                            |
| `outDir`        | `'js'`              | Must match `WEB_DIRECTORY`                                                                                                                                            |
| `alias`         | `{}`                | Extra aliases, merged after `@`                                                                                                                                       |
| `sharedRuntime` | `false`             | Import `vue`, `@nynxz/zenkit-ui`, `@nynxz/zenkit-client` from `/zenkit/runtime/` instead of bundling. Makes the pack require ComfyUI-ZenKit. Node packs leave it off. |

What the preset does:

- Externalises `@comfy/app` and `@comfy/api` and rewrites them to ComfyUI's `/scripts/app.js` and
  `/scripts/api.js`.
- Folds all CSS into `main.js` as an injected `<style>` (ComfyUI only loads `.js` from
  `WEB_DIRECTORY`).
- Sets `resolve.dedupe: ['vue']`. Two Vue copies silently break reactivity; this happens as soon as a
  `@nynxz/zenkit-*` package is consumed through a link.
- Defines `process.env.NODE_ENV = "production"`, outputs one unminified `main.js`.

### tsconfig.json

What works in both packs:

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true,
    "paths": { "@/*": ["./frontend/*"] },
    "typeRoots": ["node_modules/@types"],
  },
  // `files`, not `include`: `include` entries are filtered by `exclude`, so node_modules would drop it.
  "files": ["./node_modules/@nynxz/zenkit-nodekit/comfy.d.ts"],
  "include": ["frontend/**/*.ts", "frontend/**/*.vue"],
  "exclude": ["node_modules", "web"],
}
```

Add `frontend/vite-env.d.ts` with `/// <reference types="vite/client" />` for `import.meta.glob`.

> Note: the nodekit README says to extend `@nynxz/zenkit-nodekit/tsconfig.pack.json` and add
> `comfy.d.ts` to `include`. Neither real pack extends it, and listing `comfy.d.ts` under `include`
> while excluding `node_modules` drops it silently. Use `files`.

### package.json

```json
{
  "type": "module",
  "scripts": {
    "build": "vite build",
    "dev": "vite build --watch",
    "typecheck": "vue-tsc --noEmit"
  },
  "dependencies": { "@nynxz/zenkit-ui": "^0.2.0" },
  "devDependencies": {
    "@nynxz/zenkit-nodekit": "^0.2.0",
    "vite": "8.2.2",
    "@vitejs/plugin-vue": "6.0.8",
    "vue-tsc": "^3.3.11"
  },
  "peerDependencies": { "vue": "3.5.42" }
}
```

### Developing against a local ZenKit (pnpm overrides)

Both packs sit next to a ZenKit checkout and link to it:

```yaml
# pnpm-workspace.yaml
# pnpm refuses packages published in the last 24h; these are ours.
minimumReleaseAgeExclude:
  - '@nynxz/zenkit-ui'
  - '@nynxz/zenkit-nodekit'
overrides:
  '@nynxz/zenkit-nodekit': link:../ZenKit/packages/nodekit
  '@nynxz/zenkit-ui': link:../ZenKit/packages/ui
```

- A link resolves through the package's `exports`, which point at `dist/`. Run `pnpm build` in
  ZenKit before building the pack, or the pack sees stale code.
- The override requires the sibling layout (`../ZenKit`).
- Remove the overrides to build against npm.

> Note: the media API (`readMediaDrop`, `mediaLibrary`, …) is unreleased, not yet on npm.
> `@nynxz/zenkit-nodekit@0.2.0` on npm lacks it, so both packs only build through the `link:`
> override today.

### Shipping

`web/` is gitignored, and `pyproject.toml` lists it under `[tool.comfy] includes = ["web"]` so
the registry package still contains it. NynxzNodes' publish workflow builds `web/` and force-adds
it before `comfy node publish` (comfy-cli only archives tracked files). Use `node_modules` (no trailing slash) in
`.gitignore`, because under a pnpm workspace it can be a symlink.

## Frontend-only nodes

A node with no Python class (NynxzNodes' Group Switcher) registers its own LiteGraph type and calls
`mountWidget` itself. See [Nodekit panels and canvas](Nodekit-Panels-and-Canvas.md#mountwidget).

## Gotchas

| Gotcha                                                     | Fix                                                                                      |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `NODE_CLASS_MAPPINGS` defined alongside `comfy_entrypoint` | Remove it; nothing registers otherwise                                                   |
| `widget.value` changed but nothing updates                 | It isn't reactive. Hold state in `ref`/`reactive`, write through, call `widget.callback` |
| Run results persisted into the workflow                    | Use `nodeDef.output` + `serialize: false`, never assign `widget.value`                   |
| No widget, "Required input is missing"                     | TS filename and Python `widget_type` name disagree                                       |
| Second node needs the same widget                          | `defineNode` in another glob; one def per widget file                                    |
| Two Vue copies                                             | Keep `dedupe: ['vue']` (the preset does this)                                            |
| `comfy.d.ts` types missing                                 | Put it in `files`, not `include`                                                         |
| Linked ZenKit changes not picked up                        | `pnpm build` in ZenKit                                                                   |
