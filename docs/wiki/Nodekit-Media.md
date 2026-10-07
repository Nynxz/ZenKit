# Nodekit media

Helpers for node widgets that hold pictures, video or audio: accept drops, upload files, browse
ComfyUI's folders, and build `/view` URLs. They work with or without ZenKit.

> Unreleased, not yet on npm: everything on this page except `viewUrl` is in nodekit's working
> tree (`packages/nodekit/src/mediaRefs.ts`, `mediaLibrary.ts`, `packMedia.ts`) but not in
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

| Function          | Signature                                                                             | Description                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `readMediaDrop`   | `(e: DragEvent, subfolder = 'zenkit', upload = uploadMediaFile) => Promise<string[]>` | Refs carried by a drop. Desktop files are uploaded into `input/<subfolder>` with `upload`.                                   |
| `hasMediaDrop`    | `(e: DragEvent) => boolean`                                                           | Whether a drag carries something `readMediaDrop` understands. Checks only `dataTransfer.types`, so it works in `dragover`.   |
| `uploadMediaFile` | `(file: File, subfolder = 'zenkit') => Promise<string>`                               | POSTs to ComfyUI's `/upload/image`, returns `input/<subfolder>/<name>`. Throws on a non-OK response.                         |
| `parseMediaRef`   | `(ref: string) => { type, subfolder, filename } \| null`                              | Null unless the first segment is `input`, `output` or `temp` (and no segment is empty or `..`)                               |
| `mediaRefUrl`     | `(ref: string) => string`                                                             | `/view` URL for a ref (via `viewUrl`). Anything else (a URL, `/path`, bad ref) gets a `/view` URL ComfyUI refuses, see below |
| `mediaKind`       | `(ref: string) => 'image' \| 'video' \| 'audio'`                                      | By extension; anything unknown is `'image'`, and so is GIF. The client's `mediaKindOf`, under the name packs know it by.     |
| `viewUrl`         | `(record: Record<string, string>) => string`                                          | ComfyUI `/view?…` from a saved-image record (`{filename, subfolder, type}`), base-path safe, cache-busted. Published.        |

Only ComfyUI refs resolve. A ref a widget stored can come from a shared workflow, so `mediaRefUrl`
never turns an `http:`, `data:` or `blob:` URL, a `/path` or a malformed ref into its own URL;
it returns `/view?filename=` instead, which ComfyUI answers with 400. An `<img>` or `<video>`
then shows its error state and a `HEAD` check reports the file missing, without anything being
fetched from the address the workflow named. Use `parseMediaRef(ref)` to tell refs apart up front.

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

### Reusing files already on the server

The third argument replaces the upload. `createNodekit` provides `uploadOrReuse`, which hashes the
file (SHA-256, in the browser) and asks the pack's `/media/find` route whether the same bytes are
already somewhere in `input/`, under any name. Only new files are uploaded:

```ts
// frontend/framework.ts
export const { route, mediaLibrary, thumbUrl, uploadOrReuse, mediaInfo /* … */ } =
  createNodekit(manifest)
```

```ts
// ZenCut components/CutEditor.vue
import { readMediaDrop, uploadOrReuse } from '@/framework'
const refs = await readMediaDrop(e, 'zencut', uploadOrReuse)
```

It also works on its own: NynxzNodes saves a rendered contact sheet with
`uploadOrReuse(new File([blob], name), 'h3studio')`. Every lookup goes through `api.apiURL`, so it
works under a ComfyUI base path. Without `crypto.subtle` (a plain-http, non-localhost page), or if
the lookup fails, it simply uploads.

## Pack media helpers

Bound to the pack's `route('media')` by `createNodekit`, alongside `uploadOrReuse`:

| Member          | Signature                                               | Description                                                                                                                                           |
| --------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `thumbUrl`      | `(ref: string, size = 256) => string`                   | `<route>/thumb?type&name&size`, base-path safe: a cached JPEG of a picture or a video's first frame. `''` for audio or anything not a ref.            |
| `uploadOrReuse` | `(file: File, subfolder = 'zenkit') => Promise<string>` | The ref of an `input/` file with the same bytes, else `uploadMediaFile(file, subfolder)`                                                              |
| `mediaInfo`     | `(ref: string) => Promise<MediaInfo \| null>`           | `<route>/info`: `{ kind, duration, width, height, fps, hasAudio }`, each `null` where the server can't tell. `null` for a missing or unreadable file. |

`createPackMedia(route)` builds the same three for any other route.

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
> that runs `zenkit-nodekit sync` does ([below](#pack-side-python-routes)); one without those routes
> gets a library whose `list()` fails with 404, which is harmless unless you use it.

## Pack-side Python routes

`mediaLibrary` and the pack media helpers need four routes. `zenkit-nodekit sync` vendors them into
the pack as `nodes/_zenkit/media_api.py`, and `comfy_entrypoint` registers them (see
[Nodekit pack pattern](Nodekit-Pack-Pattern.md#python-helpers-zenkit-nodekit-sync)); the paths come
from pack.json, so they always equal `route('media')` on the frontend.

| Route                                      | Response                                                                                                                                                                                                                                        |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /<ns>/media?type=input\|output\|temp` | `{"type", "items": [{name, filename, subfolder, type, kind, size, mtime}], "truncated"}`. `name` is the path relative to the folder. Max 20000 items; hidden files and folders are skipped. 400 for an unknown folder.                          |
| `GET /<ns>/media/thumb?type=&name=&size=`  | Cached JPEG poster for an image or a video's first frame (PIL / PyAV). `size` clamped to 32–768, default 256. 404 for missing files or audio, 415 if the file can't be decoded. Cached in `<user dir>/<ns>/thumbs`, `Cache-Control: immutable`. |
| `GET /<ns>/media/info?ref=input/a.mp4`     | `{"kind", "duration", "width", "height", "fps", "has_audio"}`. 404 for a missing file, a non-media file or a ref outside input/output/temp; 415 if it can't be read.                                                                            |
| `GET /<ns>/media/find?size=&sha256=`       | `{"ref": "input/sub/name.png" \| null}`. Only files of the same size are hashed; hashes are cached per `(mtime_ns, size)`.                                                                                                                      |

Names and refs are resolved with a `realpath` + `commonpath` guard, so they can't escape their
folder, and thumbnail work is limited to four at a time.

A GIF is an image, here as everywhere in ZenKit: its thumbnail and size come from its first frame.
PyAV (which ComfyUI installs) is optional: without it, video thumbnails answer 415 and `info` still
sizes pictures, but reports `null` for everything else.

Full files are served by ComfyUI's own `/view`, and uploads go to its `/upload/image`.

## Showing run results

For images a node saves, map the `ui` output through `viewUrl` in `nodeDef.output` (see
[Nodekit pack pattern](Nodekit-Pack-Pattern.md#widgetoptions-and-nodedef)). `viewUrl` uses
`api.apiURL` (base-path safe) and ComfyUI's `app.getRandParam()` as a cache-buster, because a re-run
can reuse a filename.

> Note: when `app.getRandParam` is missing, the fallback cache-buster is `&r=<query length>`,
> which does not change between runs.

To open results fullscreen, see `openViewer` in
[Nodekit panels and canvas](Nodekit-Panels-and-Canvas.md#openviewer).
