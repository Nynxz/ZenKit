# Nodekit media

Helpers for node widgets that hold pictures, video or audio: accept drops, upload files, browse
ComfyUI's folders, and build `/view` URLs. They work with or without ZenKit.

> Unreleased, not yet on npm: everything on this page except `viewUrl` is in nodekit's working
> tree (`packages/nodekit/src/mediaRefs.ts`, `mediaLibrary.ts`) but not in
> `@nynxz/zenkit-nodekit@0.2.0`. Consumers build against it through a `link:` override (see
> [Nodekit pack pattern](Nodekit-Pack-Pattern.md#developing-against-a-local-zenkit-pnpm-overrides)).

## Media refs

A media ref is one string per file: `input/sub/name.png`, `output/name.mp4`, `temp/…`. It is the
same format ZenKit's `zen.media` uses (see [Channels and media](Channels-and-Media.md)). Widgets
store refs, display them with `mediaRefUrl`, and hand them to Python, which loads them from
ComfyUI's folders.

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { hasMediaDrop, mediaKind, mediaRefUrl, readMediaDrop } from '@/framework'

const refs = ref<string[]>([])
const over = ref(false)

function onDragOver(e: DragEvent) {
  if (!hasMediaDrop(e)) return
  e.preventDefault()
  over.value = true
}
async function onDrop(e: DragEvent) {
  over.value = false
  if (!hasMediaDrop(e)) return
  e.preventDefault() // stop ComfyUI also loading the file as a workflow
  refs.value.push(...(await readMediaDrop(e, 'mypack')))
}
</script>

<template>
  <div @dragover="onDragOver" @dragleave="over = false" @drop="onDrop">
    <template v-for="r in refs" :key="r">
      <video v-if="mediaKind(r) === 'video'" :src="mediaRefUrl(r)" muted />
      <img v-else-if="mediaKind(r) === 'image'" :src="mediaRefUrl(r)" />
    </template>
  </div>
</template>
```

| Function          | Signature                                                                             | Description                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `readMediaDrop`   | `(e: DragEvent, subfolder = 'zenkit', upload = uploadMediaFile) => Promise<string[]>` | Refs carried by a drop. Desktop files are uploaded into `input/<subfolder>` with `upload`.                                 |
| `hasMediaDrop`    | `(e: DragEvent) => boolean`                                                           | Whether a drag carries something `readMediaDrop` understands. Checks only `dataTransfer.types`, so it works in `dragover`. |
| `uploadMediaFile` | `(file: File, subfolder = 'zenkit') => Promise<string>`                               | POSTs to ComfyUI's `/upload/image`, returns `input/<subfolder>/<name>`. Throws on a non-OK response.                       |
| `parseMediaRef`   | `(ref: string) => { type, subfolder, filename } \| null`                              | Null unless the first segment is `input`, `output` or `temp`                                                               |
| `mediaRefUrl`     | `(ref: string) => string`                                                             | `/view` URL for a ref (via `viewUrl`); returns non-refs unchanged                                                          |
| `mediaKind`       | `(ref: string) => 'image' \| 'video' \| 'audio'`                                      | By extension; anything unknown is `'image'`                                                                                |
| `viewUrl`         | `(record: Record<string, string>) => string`                                          | ComfyUI `/view?…` from a saved-image record (`{filename, subfolder, type}`), base-path safe, cache-busted. Published.      |

### What `readMediaDrop` accepts

Checked in this order; the first match wins.

| Source                                       | MIME type                        | Result                                                                            |
| -------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------- |
| ZenKit drag (Media Viewer, Asset Browser, …) | `application/x-zenkit-image`     | Its `ref`, or a ref parsed from its `/view` `url`                                 |
| ComfyUI's asset browser                      | `application/x-comfy-asset-info` | `type/subfolder/filename` (type defaults to `input`)                              |
| A `/view` link                               | `text/uri-list` (first line)     | Ref parsed from the URL                                                           |
| Desktop files                                | `Files`                          | Each `image/*`, `video/*`, `audio/*` file uploaded with `upload(file, subfolder)` |

Rules:

- Call it from the `drop` handler itself. It reads the `DataTransfer` synchronously before
  awaiting, because a `DataTransfer` empties once its event returns.
- Call `e.preventDefault()` when you accept the drop.
- Only file drops return more than one ref.

> Note: nodekit's `mediaKind` treats `.gif` as video. The packs' Python `media_api.py` and
> `@nynxz/zenkit-client`'s `mediaKindOf` treat it as an image.

### Reusing files already on the server

The third argument replaces the upload. Both real packs pass `uploadOrReuse`, which hashes the
file and asks the pack's `/media/find` route whether the same bytes are already in `input/`:

```ts
// frontend/lib/inputReuse.ts (identical in NynxzNodes and ZenCut)
import { route, uploadMediaFile } from '@/framework'

async function sha256(file: File): Promise<string | null> {
  if (!crypto?.subtle) return null
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

async function existingInput(file: File): Promise<string | null> {
  try {
    const hash = await sha256(file)
    if (!hash) return null
    const res = await fetch(`${route('media/find')}?size=${file.size}&sha256=${hash}`)
    if (!res.ok) return null
    return ((await res.json()) as { ref: string | null }).ref
  } catch {
    return null
  }
}

export async function uploadOrReuse(file: File, subfolder: string): Promise<string> {
  return (await existingInput(file)) ?? uploadMediaFile(file, subfolder)
}
```

```ts
// ZenCut components/CutEditor.vue
const refs = await readMediaDrop(e, 'zencut', uploadOrReuse)
```

> Note: `uploadOrReuse` fetches `route('media/find')` without `api.apiURL`, so under a ComfyUI
> base path the lookup misses and every drop uploads a copy. Wrap the URL in `api.apiURL(...)`.

## mediaLibrary

`createNodekit` builds `mediaLibrary = createMediaLibrary(route('media'))` for every pack. It
lists ComfyUI's `input`, `output` and `temp` folders through the pack's own route and plugs
straight into `ZenMediaPicker` from `@nynxz/zenkit-ui`:

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { ZenMediaPicker } from '@nynxz/zenkit-ui'
import { mediaLibrary } from '@/framework'

const open = ref(false)
const refs = ref<string[]>([])
</script>

<template>
  <ZenMediaPicker
    v-model:open="open"
    :library="mediaLibrary"
    :kinds="['video', 'image', 'audio']"
    multiple
    subfolder="zencut"
    @pick="(r) => refs.push(...r)"
  />
</template>
```

| Member                      | Type                                                  | Description                                                                                                  |
| --------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `roots`                     | `MediaRoot[]`                                         | `['input', 'output', 'temp']`                                                                                |
| `list(root, force?)`        | `(MediaRoot, boolean) => Promise<MediaLibraryItem[]>` | `GET <route>?type=<root>`. Cached per root; `force` refetches; a failed fetch is not cached.                 |
| `upload(files, subfolder?)` | `(File[], string = 'zenkit') => Promise<string[]>`    | Uploads to `input/<subfolder>`, reusing an input file with the same name and size. Clears the `input` cache. |

`MediaLibraryItem`:

| Field           | Type                            | Description                                                    |
| --------------- | ------------------------------- | -------------------------------------------------------------- |
| `ref`           | `string`                        | `<root>/<name>`                                                |
| `root`          | `'input' \| 'output' \| 'temp'` |                                                                |
| `folder`        | `string`                        | Subfolder (`''` at the root)                                   |
| `filename`      | `string`                        |                                                                |
| `kind`          | `'image' \| 'video' \| 'audio'` | From the server                                                |
| `size`, `mtime` | `number`                        | Bytes, epoch seconds                                           |
| `url`           | `string`                        | `mediaRefUrl(ref)`                                             |
| `thumb`         | `string?`                       | `<route>/thumb?type&name&size=320&v=<mtime>`; absent for audio |

For any other route, call `createMediaLibrary(route)` yourself.

> Note: every `createNodekit` builds a library, which assumes the pack serves `/<ns>/media`. A pack
> without those routes gets a library whose `list()` fails with 404; that is harmless unless you use
> it.

## Pack-side Python routes

The library and `uploadOrReuse` need three routes. nodekit ships no Python; both packs carry a
copy of `nodes/_lib/media_api.py` (ZenCut's is NynxzNodes' with the namespace replaced), imported
for its side effect in `nodes/__init__.py`:

```python
from ._lib import media_api  # noqa: F401  (registers /zencut/media* routes on import)
```

| Route                                      | Response                                                                                                                                                                                                                                        |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /<ns>/media?type=input\|output\|temp` | `{"type", "items": [{name, filename, subfolder, type, kind, size, mtime}], "truncated"}`. `name` is the path relative to the folder. Max 20000 items; hidden files and folders are skipped. 400 for an unknown folder.                          |
| `GET /<ns>/media/thumb?type=&name=&size=`  | Cached JPEG poster for an image or a video's first frame (PIL / PyAV). `size` clamped to 32–768, default 256. 404 for missing files or audio, 415 if the file can't be decoded. Cached in `<user dir>/<ns>/thumbs`, `Cache-Control: immutable`. |
| `GET /<ns>/media/find?size=&sha256=`       | `{"ref": "input/sub/name.png" \| null}`. Only files of the same size are hashed; hashes are cached per `(mtime_ns, size)`.                                                                                                                      |

The core of it:

```python
try:
    from server import PromptServer
    _routes = PromptServer.instance.routes
except Exception:
    _routes = None   # outside ComfyUI

if _routes is not None:
    @_routes.get("/zencut/media")
    async def zencut_media(request):
        folder = request.query.get("type", "input")
        if folder not in FOLDERS:
            return web.json_response({"error": f"unknown folder: {folder}", "items": []}, status=400)
        items = await asyncio.to_thread(list_media, folder)
        return web.json_response({"type": folder, "items": items, "truncated": len(items) >= MAX_ITEMS})

    @_routes.get("/zencut/media/find")
    async def zencut_media_find(request):
        try:
            size = int(request.query.get("size", ""))
        except ValueError:
            return web.json_response({"ref": None}, status=400)
        sha256 = request.query.get("sha256", "").lower()
        ref = await asyncio.to_thread(find_input, size, sha256) if sha256 else None
        return web.json_response({"ref": ref})
```

The thumb route resolves `name` with a `realpath` + `commonpath` guard so it can't escape the
folder, and limits concurrent thumbnail work with `asyncio.Semaphore(4)`.

Full files are served by ComfyUI's own `/view`, and uploads go to its `/upload/image`.

> Note: the route strings and cache directory name are hard-coded per pack, not derived from
> `pack.json`. Keep them equal to `route('media')` on the frontend.

## Showing run results

For images a node saves, map the `ui` output through `viewUrl` in `nodeDef.output` (see
[Nodekit pack pattern](Nodekit-Pack-Pattern.md#widgetoptions-and-nodedef)). `viewUrl` uses
`api.apiURL` (base-path safe) and ComfyUI's `app.getRandParam()` as a cache-buster, because a re-run
can reuse a filename.

> Note: when `app.getRandParam` is missing, the fallback cache-buster is `&r=<query length>`,
> which does not change between runs.

To open results fullscreen, see `openViewer` in
[Nodekit panels and canvas](Nodekit-Panels-and-Canvas.md#openviewer).
