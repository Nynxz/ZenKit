# Channels and media

Four pieces for moving images, video and audio between plugins:

| Piece                           | For                                                                    |
| ------------------------------- | ---------------------------------------------------------------------- |
| [Channels](#channels)           | A named live feed: producers publish the latest item, views subscribe. |
| [Media refs](#media-refs)       | One string per file, resolvable to a URL or a loader-node input.       |
| [Drag and drop](#drag-and-drop) | Dragging media between panels, the graph and loader nodes.             |
| [Viewer](#viewer)               | The one shared full-screen lightbox.                                   |

## Channels

### Minimal example

```ts
import { LAST_CHANNEL, whenZen } from '@nynxz/zenkit-client'

const zen = await whenZen() // null without ZenKit

// A view
const stop = zen?.channels.subscribe('preview', (img) => (imgEl.src = img.url))

// A producer
zen?.channels.publish('preview', { filename: 'ComfyUI_00012_.png', type: 'output' })

// Anything published anywhere
zen?.channels.subscribe(LAST_CHANNEL, (img) => console.log(img.channel, img.url))
```

Channel names are global, never prefixed with your plugin id: a channel is how plugins share media.

Declare channels up front so views can list them before anything is published:

```ts
registerZenPlugin({
  id: 'myplugin',
  plugin: 'My Plugin',
  channels: ['preview', { name: 'ref', label: 'Reference' }],
})
```

### API

| `window.ZenKit.channels`    | Meaning                                                                                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `publish(name, input)`      | Set the channel's latest item. `''` means `'default'`.                                                                                          |
| `declare(name, { label? })` | List a channel before it has content.                                                                                                           |
| `subscribe(name, cb)`       | Called on each publish. `'$last'` (`LAST_CHANNEL`) = every channel. Returns unsubscribe. Does not replay the current item; call `get` for that. |
| `get(name)`                 | Latest `ChannelImage` or `null`. `'$last'` works.                                                                                               |
| `last()`                    | Most recent item on any channel.                                                                                                                |
| `list()`                    | Declared and published channel names.                                                                                                           |

`ChannelInput` (what you publish): either `url`, or `filename` + `subfolder?` + `type?`
(`input` / `output` / `temp`, default `temp`) which ZenKit turns into a `/view` URL (through
ComfyUI's API base, like `media` URLs). Optional `ref` (its media ref, when you know it), `label`,
`kind` (`'image' | 'video' | 'audio'`, absent means image), `width`, `height`.

`ChannelImage` (what subscribers get) adds `channel` and `ts`, and always has `url`. Its `ref` is
the one you gave, else derived: `output/sub/name.png` for a ComfyUI file, else the `url` itself
(a URL is a valid ref). So a subscriber can hand it straight to a capability.

Bus mirror: `channel` and `channel:<name>` with the `ChannelImage`; `channels:change` with the name
when a new channel appears.

### From Python

Send the `zenkit.channel` websocket event. With `filename` or `url` it publishes; with only
`channel` (and optional `label`) it declares.

```python
from server import PromptServer

PromptServer.instance.send_sync("zenkit.channel", {
    "channel": "preview",
    "filename": fn, "subfolder": "", "type": "temp",
    "kind": "image",          # or "video" / "audio"
    "width": w, "height": h,  # optional
    "label": "Step 3",        # optional
})
```

There is no shared Python helper; `send_sync` without a client id goes to every connected tab.
Events that arrive before the ZenKit runtime has installed are buffered (up to 200) and replayed.
ComfyUI-ZenSuite's **Zen Sync** nodes and **Media Viewer** panel are the reference producer and
consumer (`plugins/ComfyUI-ZenSuite/channel_node.py`).

## Media refs

A `MediaRef` is a short string that names one file, so capabilities and agents can pass media
along without URLs.

| Ref                                      | Means                                                    |
| ---------------------------------------- | -------------------------------------------------------- |
| `output/sub/name.png`                    | ComfyUI's output folder (also `input/…`, `temp/…`)       |
| `https://…`, `data:…`, `blob:…`, `/path` | Used as-is                                               |
| `<prefix>:…` or `<prefix>/…`             | Resolved by a source a plugin registered for that prefix |

```ts
const zen = await whenZen()
const info = await zen!.media.resolve('output/ComfyUI_00012_.png')
// { ref, url: '/api/view?…', kind: 'image', label: 'ComfyUI_00012_.png' }

const widgetValue = await zen!.media.toInput('output/ComfyUI_00012_.png')
// 'ComfyUI_00012_.png [output]'  → set a LoadImage widget to this

const ref = zen!.media.fromComfyFile({ filename: 'a.png', subfolder: 'x', type: 'output' })
// 'output/x/a.png'
```

| `window.ZenKit.media`                            | Meaning                                                                                                                                                                                                                      |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resolve(ref)`                                   | `Promise<MediaInfo>` (`{ ref, url, kind, label? }`). Rejects for an unknown prefix.                                                                                                                                          |
| `toInput(ref)`                                   | Value for a ComfyUI loader widget. `input/` refs give the path, `output/` and `temp/` give `path [output]` / `path [temp]`, other refs use the source's `toInput`, else the file is fetched and uploaded to `input/zenkit/`. |
| `fromComfyFile({ filename, subfolder?, type? })` | The ref for a file as `executed` / history outputs describe it.                                                                                                                                                              |
| `registerSource(source)`                         | Handle a prefix. Returns unregister.                                                                                                                                                                                         |

### Adding a source

```ts
const off = zen.media.registerSource({
  prefix: 'stash', // refs like 'stash:1234'
  resolve: async (ref) => {
    const id = ref.slice('stash:'.length)
    return { ref, url: `/stash/file/${id}`, kind: 'image', label: `Stash ${id}` }
  },
  // toInput omitted: ZenKit downloads the url and uploads it to input/
})
```

The prefix is everything before the first `:` or `/`. Registering the same prefix replaces the
previous source.

## Drag and drop

Helpers in `@nynxz/zenkit-client`; they don't need the runtime.

```vue
<img
  :src="thumbUrl({ filename, type: 'output' })"
  draggable="true"
  @dragstart="(e) => setImageDragData(e, { url: viewUrl, filename, type: 'output' })"
/>

<div @dragover="(e) => hasImageDragData(e) && e.preventDefault()" @drop="onDrop" />
```

```ts
async function onDrop(e: DragEvent) {
  const { title, items } = await readMediaListDrop(e) // call synchronously from the handler
  if (!items.length) return // not ours: let ComfyUI handle it
  e.preventDefault() // stop ComfyUI also importing it into the graph
  for (const it of items) show(it.url, it.kind)
}
```

| Export                                                      | Meaning                                                                                                                                                                                                                                    |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `setImageDragData(e, img, dragImage?)`                      | Start a drag of one item. `img`: `{ url, filename?, subfolder?, type?, hasWorkflow?, ref? }`. With `filename` + `type` it also sets ComfyUI's asset MIME, so dropping on a loader node reuses the server file instead of uploading a copy. |
| `readImageDragData(e)`                                      | `DroppedImage[]` from ZenKit's payload, ComfyUI's asset drag, a URL, or desktop files. `[]` when there is nothing usable.                                                                                                                  |
| `readMediaListDrop(e)`                                      | Async. Same, but expands a dragged media list. Returns `{ title?, items }`.                                                                                                                                                                |
| `setMediaListDragData(e, { url, title?, count? })`          | Drag a whole collection. `url` must return a `MediaList` (`{ title?, items: [{ url, filename?, kind?, label? }] }`) as JSON. Set a single image too, for targets that take one.                                                            |
| `hasImageDragData(e)`                                       | For `dragover`, where data can't be read yet. Checks the types only.                                                                                                                                                                       |
| `mediaKindOf(nameOrUrl)`                                    | `'image' \| 'video' \| 'audio'` from extension or `data:` type. GIF is an image.                                                                                                                                                           |
| `thumbUrl({ filename, subfolder?, type? }, size = 256)`     | ComfyUI-ZenKit's cached thumbnail (`/zenkit/thumb`, JPEG, video first frame).                                                                                                                                                              |
| `ZEN_IMAGE_MIME`, `COMFY_ASSET_MIME`, `ZEN_MEDIA_LIST_MIME` | The MIME types.                                                                                                                                                                                                                            |

`DroppedImage` is `{ url, ref?, filename?, kind?, objectUrl? }`. When `objectUrl` is true the url
was created from a desktop file: call `URL.revokeObjectURL(url)` when done.

## Viewer

One full-screen lightbox owned by ZenKit, shared by every plugin.

```ts
import { openViewer } from '@nynxz/zenkit-client'

const viewer = await openViewer(
  [
    { src: '/api/view?filename=a.png&type=output', label: 'a.png', meta: '1024×1024' },
    { src: '/api/view?filename=b.mp4&type=output', kind: 'video' },
  ],
  { index: 0, onIndex: (i) => console.log('showing', i), onClose: () => console.log('closed') },
)
viewer?.setIndex(1)
```

In a Vue component, `useLightbox()` wraps this with reactive `isOpen` / `index` and closes the
viewer when the component unmounts:

```ts
const lightbox = useLightbox()
lightbox.open(items, { index: 3 })
```

| `ViewerItem` field | Meaning                                       |
| ------------------ | --------------------------------------------- |
| `src`              | Full-size URL.                                |
| `kind`             | `'image'` (default), `'video'`, `'audio'`.    |
| `label`, `meta`    | Title and small caption.                      |
| `onWorkflow`       | Shows a "Load workflow" button that calls it. |

| `window.ZenKit.viewer`                        | Meaning                                                                                                                                                                           |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `open(items, { index?, onIndex?, onClose? })` | Opens, replacing any open viewer (whose `onClose` fires). Returns `{ close(), setIndex(i) }`, which act on this viewer only: once another `open` has replaced it they do nothing. |
| `close()`                                     | Close the current viewer.                                                                                                                                                         |

Without ZenKit, `openViewer` opens the selected item in a new tab and resolves `null`.
