# @nynxz/zenkit-nodekit

Everything a ComfyUI custom-node pack needs from ZenKit: the Vite build, the ambient `@comfy/*`
types, the machinery to put a Vue component inside a node body, and (via `zenkit-nodekit sync`)
the Python half that has to agree with it.

A pack built on nodekit works on a plain ComfyUI. Panels, the shared viewer and slot links light
up when the ZenKit runtime is installed and degrade when it isn't. The ZenKit code nodekit uses is
`@nynxz/zenkit-client`'s, bundled into nodekit, so a pack doesn't depend on the client.

## Install

```sh
pnpm add -D @nynxz/zenkit-nodekit@^0.3.0
pnpm add @nynxz/zenkit-ui@^0.3.0    # the themed component set
```

To build a pack against a local ZenKit checkout, see
[Developing against a local ZenKit](https://github.com/Nynxz/ZenKit/wiki/Nodekit-Pack-Pattern#developing-against-a-local-zenkit).

## Minimal setup

`pack.json` holds the pack's identity, read by `createNodekit` at build time and by
`zenkit-nodekit sync`:

```json
{ "namespace": "nynxz", "displayName": "Nynxz Nodes", "category": "Nynxz" }
```

**`frontend/framework.ts`**: the pack's one import of nodekit; everything else imports from here.

```ts
import { createNodekit } from '@nynxz/zenkit-nodekit'
import manifest from '../pack.json'

export * from '@nynxz/zenkit-nodekit'
export const { NAMESPACE, nodeId, route, registerNodes, discoverNodes, discoverWidgets } =
  createNodekit(manifest)
```

**`frontend/main.ts`**

```ts
import '@nynxz/zenkit-ui/style.css'
import '@nynxz/zenkit-ui/comfy-bridge.css'
import { discoverNodes, discoverWidgets, registerNodes } from '@/framework'

const widgets = import.meta.glob('./widgets/*.vue', { eager: true })
const nodes = import.meta.glob('./nodes/*.ts', { eager: true })
registerNodes([...discoverWidgets(widgets), ...discoverNodes(nodes)])
```

**`vite.config.mts`**

```ts
import { zenPluginConfig } from '@nynxz/zenkit-nodekit/vite'

export default zenPluginConfig({
  configUrl: import.meta.url,
  srcDir: './frontend',
  outDir: 'web', // must match WEB_DIRECTORY
})
```

`frontend/widgets/LoraStack.vue` registers the io type `NYNXZ_LORA_STACK`; the Python side
declares an input of that type with `widget_type("LoraStack", list)`.

## Python: `zenkit-nodekit sync`

```sh
zenkit-nodekit sync            # write nodes/_zenkit/ from pack.json (idempotent)
zenkit-nodekit sync --check    # CI: exit 1 when it is stale or missing
zenkit-nodekit check-widgets   # CI: every widget_type() has its widgets/*.vue, and back
```

The vendored package gives the pack `NAMESPACE`, `node_id()`, `route()`, `widget_type()`, node
autodiscovery, the media routes below, `Job` progress events, and a `comfy_entrypoint` that wires
them up. Commit `nodes/_zenkit/`; never edit it.

The media routes, under `route('media')`:

```
GET /<ns>/media?type=input|output|temp        {"items": [{name, filename, subfolder, type, kind, size, mtime}]}
GET /<ns>/media/thumb?type=&name=&size=[&t=]  a JPEG poster (images; a video's frame at t seconds, first frame without t)
GET /<ns>/media/info?ref=input/a.mp4          {kind, duration, width, height, fps, has_audio}
GET /<ns>/media/find?size=&sha256=            {"ref": "input/sub/name.png" | null}
```

## More

- [Nodekit pack pattern](https://github.com/Nynxz/ZenKit/wiki/Nodekit-Pack-Pattern): layout,
  `createNodekit`, the widget contract, `widgetOptions` / `nodeDef`, the Python helpers, build setup
- [Nodekit media](https://github.com/Nynxz/ZenKit/wiki/Nodekit-Media): drops, uploads, media refs,
  the media library and routes
- [Nodekit panels and canvas](https://github.com/Nynxz/ZenKit/wiki/Nodekit-Panels-and-Canvas):
  `mountWidget`, `openZenPanel`, header buttons, slot links, the viewer
