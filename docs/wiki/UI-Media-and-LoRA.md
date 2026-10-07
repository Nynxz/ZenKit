# UI: media and LoRA

Viewers, players, pickers and timelines, plus the LoRA picker family. Part of
[`@nynxz/zenkit-ui`](UI-Components.md).

> Unreleased, not yet on npm: everything on this page except ZenLightbox. `@nynxz/zenkit-ui@0.2.0`
> exports only ZenLightbox from this group. In-repo plugins and linked node packs already use the
> rest.

## ZenLightbox

An image/video/audio viewer: wheel-zoom about the pointer, drag to pan, rotate, slideshow, a
searchable thumbnail strip, download, and an optional "Load workflow" button. Fullscreen by
default, or `inline` inside a container.

```vue
<ZenLightbox v-if="viewing" :items="images" v-model:index="current" @close="viewing = false" />
```

Visibility is mount/unmount: there is no `open` prop.

| Prop             | Type                          | Default    | Description                                                                                 |
| ---------------- | ----------------------------- | ---------- | ------------------------------------------------------------------------------------------- |
| `items`          | `LightboxItem[]`              | required   |                                                                                             |
| `index`          | `number`                      | required   | Use `v-model:index`                                                                         |
| `inline`         | `boolean`                     | `false`    | Fill the container instead of a fullscreen overlay                                          |
| `slideshowMs`    | `number`                      | `3000`     | Inline only; the overlay remembers its own speed                                            |
| `slideshowToEnd` | `boolean`                     | `true`     | Inline only: videos and audio play to the end before advancing                              |
| `controls`       | `'bottom' \| 'top' \| 'none'` | `'bottom'` | `'none'` also hides the nav zones; `'top'` behaves like `'bottom'` (kept for compatibility) |

`LightboxItem`:

| Field        | Type                            | Description                                  |
| ------------ | ------------------------------- | -------------------------------------------- |
| `src`        | `string`                        | Full-size URL                                |
| `kind`       | `'image' \| 'video' \| 'audio'` | Optional                                     |
| `label`      | `string`                        | Title in the toolbar                         |
| `meta`       | `string`                        | Caption (dimensions, size)                   |
| `onWorkflow` | `() => void`                    | Shows a "Load workflow" button that calls it |

| Event          | Payload  |
| -------------- | -------- |
| `update:index` | `number` |
| `close`        | —        |

Exposed: `zoom`, `rot`, `playing` (refs), `zoomIn()`, `zoomOut()`, `reset()`, `rotate(deg)`,
`togglePlay()`, `prev()`, `next()`.

In overlay mode it handles Escape, ←/→, `+`/`=`/`-`, `0`, `r`/`R`, Space and the ZenMediaControls
keys. Remembers the strip state and slideshow settings in `localStorage`
(`zenkit.lightbox.strip`, `zenkit.lightbox.slideshow`).

In a ZenKit plugin you usually want the shared viewer instead (`openViewer` in
`@nynxz/zenkit-client`, see [Channels and media](Channels-and-Media.md)).

## ZenMediaControls

A control bar for a `<video>` or `<audio>` element you own: play, frame step, scrubber (buffered
range, hover time), loop, rate, volume. Switches to compact under 420px and tiny under 300px.

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { ZenMediaControls } from '@nynxz/zenkit-ui'

const video = ref<HTMLVideoElement | null>(null)
const controls = ref<InstanceType<typeof ZenMediaControls> | null>(null)
</script>

<template>
  <div tabindex="0" @keydown="(e) => controls?.onKey(e) && e.preventDefault()">
    <video ref="video" :src="src" />
    <ZenMediaControls ref="controls" :media="video" :fps="30" />
  </div>
</template>
```

| Prop      | Type                       | Default  | Description                             |
| --------- | -------------------------- | -------- | --------------------------------------- |
| `media`   | `HTMLMediaElement \| null` | required |                                         |
| `fps`     | `number`                   | `24`     | For frame stepping and timecode         |
| `compact` | `boolean`                  | `false`  | Force the compact layout                |
| `noLoop`  | `boolean`                  | —        | Play once whatever the loop button says |

| Exposed                            | Description                                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `onKey(e: KeyboardEvent): boolean` | Forward keys from your host; returns whether it handled one. Space/`k` play, `j`/`l` ±5 s, `,`/`.` frame step, `m` mute. |
| `toggle()`                         | Play/pause                                                                                                               |
| `seek(t: number)`                  | Seconds                                                                                                                  |

Volume is remembered in `localStorage` (`zenkit.media.volume`).

## ZenMediaPicker

A modal media browser: folder tree, filterable virtualised grid (videos play on hover), preview
pane, ordered multi-select, and drag-drop or button upload. It reads from a `library` you pass in;
nodekit's `mediaLibrary` fits it directly ([Nodekit media](Nodekit-Media.md#medialibrary)).

```vue
<ZenMediaPicker
  v-model:open="picking"
  :library="mediaLibrary"
  :kinds="['image']"
  subfolder="mypack"
  @pick="(refs) => (selected = refs)"
/>
```

| Prop           | Type                 | Default                       | Description                     |
| -------------- | -------------------- | ----------------------------- | ------------------------------- |
| `open`         | `boolean`            | required                      | Use `v-model:open`              |
| `library`      | `MediaPickerLibrary` | required                      | Data source                     |
| `kinds`        | `MediaPickerKind[]`  | `['image', 'video', 'audio']` | Which kinds are shown           |
| `multiple`     | `boolean`            | `true`                        |                                 |
| `title`        | `string`             | `'Choose media'`              |                                 |
| `confirmLabel` | `string`             | `'Add'`                       |                                 |
| `subfolder`    | `string`             | `'zenkit'`                    | Upload target under `input/`    |
| `selected`     | `string[]`           | `[]`                          | Refs pre-selected when it opens |

| Event         | Payload    | Description                 |
| ------------- | ---------- | --------------------------- |
| `update:open` | `boolean`  |                             |
| `pick`        | `string[]` | Chosen refs, in click order |

```ts
type MediaPickerKind = 'image' | 'video' | 'audio'

interface MediaPickerLibrary {
  roots: string[]
  list(root: string, force?: boolean): Promise<MediaPickerItem[]>
  upload?(files: File[], subfolder?: string): Promise<string[]> // omit to hide upload
}

interface MediaPickerItem {
  ref: string
  root: string
  folder: string
  filename: string
  kind: MediaPickerKind
  size: number
  mtime: number
  url: string
  thumb?: string
}
```

Remembers view settings and open folders in `localStorage` (`zenkit.mediaPicker`,
`zenkit.mediaPicker.open`).

## ZenTimeline

A controlled multi-track timeline: clips and markers, curve tracks, level/shape tracks, ruler
scrubbing, zoom, guides, a range, reorderable track headers with actions, and drop targets. It
renders `tracks` and reports edits through events; you update the data.

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { ZenTimeline, type TimelineTrack } from '@nynxz/zenkit-ui'

const t = ref(0)
const zoom = ref(0) // 0 = fit
const tracks = ref<TimelineTrack[]>([
  {
    id: 'v1',
    label: 'Video',
    icon: 'mdi-filmstrip',
    items: [
      { id: 'a', start: 0, end: 4, label: 'intro.mp4', resize: 'both' },
      { id: 'b', start: 4, end: 9, label: 'main.mp4' },
    ],
  },
  { id: 'marks', label: 'Markers', items: [{ id: 'm1', start: 2, kind: 'marker' }] },
])

function onMove(itemId: string, trackId: string, change: { start?: number; end?: number }) {
  const item = tracks.value.find((tr) => tr.id === trackId)?.items.find((i) => i.id === itemId)
  if (item) Object.assign(item, change)
}
</script>

<template>
  <ZenTimeline
    :duration="12"
    :tracks="tracks"
    v-model:playhead="t"
    v-model:zoom="zoom"
    @move="onMove"
  />
</template>
```

| Model              | Type     | Default | Description                          |
| ------------------ | -------- | ------- | ------------------------------------ |
| `v-model:playhead` | `number` | `0`     | Seconds                              |
| `v-model:zoom`     | `number` | `0`     | px per second; `0` fits the duration |

| Prop         | Type                                     | Default  | Description                                                                                                                                                                                                                             |
| ------------ | ---------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `duration`   | `number`                                 | required | Seconds                                                                                                                                                                                                                                 |
| `tracks`     | `TimelineTrack[]`                        | required |                                                                                                                                                                                                                                         |
| `selected`   | `string \| string[] \| null`             | `null`   | Selected item id(s)                                                                                                                                                                                                                     |
| `snap`       | `number`                                 | `0.05`   | Seconds                                                                                                                                                                                                                                 |
| `guides`     | `number[]`                               | `[]`     | Vertical lines through every track (e.g. scene boundaries)                                                                                                                                                                              |
| `range`      | `{ start: number; end: number } \| null` | `null`   | Highlighted range                                                                                                                                                                                                                       |
| `headWidth`  | `number`                                 | `112`    | Track header width in px                                                                                                                                                                                                                |
| `magnet`     | `number \| false`                        | `6`      | Magnetic snapping in px: a moved item's edges, a trimmed edge or a drop catch on other items' edges, the playhead and `snapPoints`, with a line while caught. Alt held while dragging skips it. Otherwise times fall on the `snap` grid |
| `snapPoints` | `number[]`                               | `[]`     | Extra snap targets (markers, beats)                                                                                                                                                                                                     |

| Event      | Payload                                      | Description                                     |
| ---------- | -------------------------------------------- | ----------------------------------------------- |
| `select`   | `(itemId \| null, trackId, PointerEvent)`    | Curve tracks send `'curve:<trackId>'` as the id |
| `open`     | `(itemId, trackId)`                          | Double-click on an item                         |
| `move`     | `(itemId, trackId, { start?, end? })`        | Drag or resize                                  |
| `context`  | `(target: TimelineTarget, time, MouseEvent)` | Right-click                                     |
| `drop`     | `(trackId, time, DragEvent)`                 | Something dropped on a track                    |
| `dblclick` | `(trackId, time)`                            | Double-click on empty track space               |
| `reorder`  | `(trackId, beforeId \| null)`                | A movable track header was dragged              |
| `curve`    | `(trackId, points: { t, v }[])`              | Curve edited                                    |
| `level`    | `(trackId, segmentId, v \| null)`            | Level segment changed                           |
| `shape`    | `(trackId, segmentId, points: { x, y }[])`   | Segment shape changed                           |
| `action`   | `(trackId, actionId)`                        | Header action clicked                           |

Exposed: `timeAt(clientX): number`, `follow()` (scroll the playhead into view).

### Timeline types

`TimelineTrack`:

| Field         | Type                     | Description                                                                                                                                             |
| ------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`, `label` | `string`                 |                                                                                                                                                         |
| `title`       | `string?`                | Full name on hover                                                                                                                                      |
| `icon`        | `string?`                | MDI glyph                                                                                                                                               |
| `thumb`       | `string?`                | Picture in the header instead of the icon                                                                                                               |
| `movable`     | `boolean?`               | Header can be dragged among other movable tracks                                                                                                        |
| `color`       | `string?`                | Header stripe                                                                                                                                           |
| `curve`       | `TimelineCurve?`         | `{ points: {t, v}[], min?, max?, flat?, steps?, color?, unit? }`                                                                                        |
| `levels`      | `TimelineLevels?`        | `{ segments: [{ id, start, end, v, inherited?, title?, shape?, shapeInherited? }], mode?: 'levels' \| 'shape', min?, max?, unit?, color?, shapeFlat? }` |
| `actions`     | `TimelineTrackAction[]?` | `{ id, icon?, label?, title?, active? }`                                                                                                                |
| `height`      | `number?`                | px                                                                                                                                                      |
| `items`       | `TimelineItem[]`         |                                                                                                                                                         |

`TimelineItem`:

| Field                                      | Type                                  | Description                                                                                                                                                                               |
| ------------------------------------------ | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                       | `string`                              |                                                                                                                                                                                           |
| `start`, `end`                             | `number`, `number?`                   | Seconds. A marker uses only `start`.                                                                                                                                                      |
| `kind`                                     | `'clip' \| 'marker'`                  |                                                                                                                                                                                           |
| `label`, `title`, `color`, `thumb`, `icon` | `string?`                             |                                                                                                                                                                                           |
| `muted`                                    | `boolean?`                            |                                                                                                                                                                                           |
| `ghost`                                    | `boolean?`                            | Placeholder slot: dashed, not draggable                                                                                                                                                   |
| `resize`                                   | `'start' \| 'end' \| 'both' \| false` | Draggable edges (clips default `'end'`)                                                                                                                                                   |
| `movable`                                  | `boolean?`                            | Markers default yes, clips no                                                                                                                                                             |
| `commit`                                   | `'live' \| 'drop'`                    | `'drop'` emits one `move` on release instead of on every step                                                                                                                             |
| `progress`                                 | `number?`                             | 0–1 progress fill along the bottom edge                                                                                                                                                   |
| `group`                                    | `string?`                             | Items sharing a group move together (a video and its sound): a drag shows them following, and they never snap to each other. A selected item drags the rest of the selection the same way |

`TimelineTarget`: `{ trackId: string; itemId?: string }`.

## ZenStepChart

A canvas chart of a sampler run: the sigma schedule (dashed) and the per-step change (filled).
Hover, click, drag or arrow keys pick a step.

```vue
<ZenStepChart
  :sigmas="sigmas"
  :deltas="deltas"
  :total="steps + 1"
  :current="done"
  v-model:hover="hoverStep"
  v-model:locked="lockedStep"
/>
```

| Model            | Type             | Default | Description            |
| ---------------- | ---------------- | ------- | ---------------------- |
| `v-model:hover`  | `number \| null` | `null`  | Step under the pointer |
| `v-model:locked` | `number \| null` | `null`  | Step pinned by click   |

| Prop         | Type               | Default  | Description                                     |
| ------------ | ------------------ | -------- | ----------------------------------------------- |
| `total`      | `number`           | required | Boundaries in the run (steps + 1)               |
| `sigmas`     | `number[] \| null` | `null`   | One sigma per boundary                          |
| `deltas`     | `number[]`         | `[]`     | Change made by step `i + 1`                     |
| `current`    | `number`           | `-1`     | Newest boundary that has arrived                |
| `hoverScrub` | `boolean`          | `true`   | Hover drives `hover`; `false` = click/drag only |

Colours are read at draw time from `--zen-border`, `--zen-muted`, `--zen-accent` and `--zen-text`.

## LoRA setup

The LoRA components are UI only. The host pack owns the routes and registers a data source once,
before any LoRA component renders:

```ts
// NynxzNodes frontend/main.ts + lib/loraApi.ts (abridged)
import { setLoraDetailOpener, setLoraSource, type LoraSource } from '@nynxz/zenkit-ui'
import { route } from '@/framework'

const loraSource: LoraSource = {
  list: async () => (await (await fetch(route('loras'))).json()).loras ?? [],
  favorites: async () => (await (await fetch(route('favorites'))).json()).loras ?? [],
  setFavorite: async (name, pinned) =>
    (
      await (
        await fetch(route('favorites'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, pinned }),
        })
      ).json()
    ).loras ?? [],
  previewUrl: (name) => `${route('lora/preview')}?name=${encodeURIComponent(name)}`,
  mediaUrl: (name) => `${route('lora/preview')}?raw=1&name=${encodeURIComponent(name)}`,
  info: async (name) => {
    const res = await fetch(`${route('lora/info')}?name=${encodeURIComponent(name)}`)
    return res.ok ? res.json() : null
  },
}

setLoraSource(loraSource)
setLoraDetailOpener(openLoraDetailPanel) // optional: show details in a ZenKit panel
```

`LoraSource`:

| Member        | Signature                                        | Description                                                              |
| ------------- | ------------------------------------------------ | ------------------------------------------------------------------------ |
| `list`        | `(force?: boolean) => Promise<LoraItem[]>`       | Every LoRA on disk                                                       |
| `previewUrl`  | `(name) => string`                               | Same-origin URL of a still preview                                       |
| `mediaUrl`    | `(name) => string` (optional)                    | The preview as-is (video for a video preview). Defaults to `previewUrl`. |
| `info`        | `(name) => Promise<LoraInfo \| null>` (optional) | Details for LoraDetail                                                   |
| `favorites`   | `(force?: boolean) => Promise<string[]>`         | Bookmarked names                                                         |
| `setFavorite` | `(name, pinned) => Promise<string[]>`            | Returns the new complete list                                            |

`LoraItem`: `{ name, has_preview, preview?: 'image' | 'video' | null, favorite?, size?, mtime? }`
(`name` is the relative path with `/`). `LoraInfo` carries `title`, `version`, `base_model`,
`creator`, `url`, `sha256`, `trigger_words`, `tags`, `description`, `notes`, `usage`, `images`
(`LoraExample[]`), `training`; every field but `name` is optional.

| Function                          | Description                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `setLoraSource(source)`           | Register the data source (required)                                                                           |
| `openLoraDetail(name)`            | Show details: the opener if set, else a built-in ZenModal with LoraDetail                                     |
| `setLoraDetailOpener(fn \| null)` | `fn(name)` returns `true` if it showed the details itself (e.g. via `openZenPanel`), `false` to use the modal |
| `loraLibrary`                     | The shared store (namespace export), see below                                                                |

`loraLibrary` (one store for every LoRA component on the page):

| Member                                                      | Description                                  |
| ----------------------------------------------------------- | -------------------------------------------- |
| `loras`, `favorites`, `listLoaded`                          | Refs                                         |
| `ensure(force?)`                                            | Load the list and favourites once            |
| `folderNav`, `setFolderNav(on)`                             | Picker steps through folders (default on)    |
| `blurMature`, `setBlurMature(on)`                           | Blur examples rated R and above (default on) |
| `folderIndex`                                               | Computed folder map                          |
| `short(name)`, `folder(name)`                               | Name helpers                                 |
| `hasPreview`, `preview`, `previewKind`, `media`, `hasThumb` | Preview helpers                              |
| `hasInfo()`, `info(name)`                                   | Details                                      |
| `isFav`, `toggleFav`                                        | Favourites                                   |
| `isMissing(name)`                                           | Not in the current listing                   |
| `onThumbError`, `onImageError`                              | Error handlers for `<img>`                   |

## LoraPicker

A ZenCombo for LoRAs: folder navigation with breadcrumbs, bookmarks, thumbnails and a "browse all"
button.

```vue
<LoraPicker v-model="lora" @browse="browserOpen = true" />
<LoraBrowser
  v-model:open="browserOpen"
  :selected="lora"
  @pick="
    (n) => {
      lora = n
      browserOpen = false
    }
  "
/>
```

| Prop          | Type     | Default            | Description |
| ------------- | -------- | ------------------ | ----------- |
| `modelValue`  | `string` | required           | LoRA name   |
| `placeholder` | `string` | `'Select a LoRA…'` |             |
| `menuWidth`   | `number` | `400`              | px          |

| Event               | Payload  | Description                                         |
| ------------------- | -------- | --------------------------------------------------- |
| `update:modelValue` | `string` |                                                     |
| `browse`            | —        | User asked for the full browser; open a LoraBrowser |

## LoraBrowser

A modal for the whole library: folder tree (plus All and Bookmarked), grid or list view
(virtualised), sorting and card size, a LoraDetail pane, keyboard navigation.

| Prop       | Type      | Default  | Description                |
| ---------- | --------- | -------- | -------------------------- |
| `open`     | `boolean` | required | Use `v-model:open`         |
| `selected` | `string`  | —        | Focused and marked on open |

| Event         | Payload   |
| ------------- | --------- |
| `update:open` | `boolean` |
| `pick`        | `string`  |

Remembers sort, size and view in `localStorage` (`zenkit.loraBrowser`, `zenkit.loraBrowser.open`).

## LoraThumb

A 40px (or 18px) LoRA tile: preview, placeholder, or a "not on disk" warning. Shift-hover shows a
peek; Shift-click opens details.

```vue
<LoraThumb :name="row.lora" sm check-missing />
```

| Prop           | Type      | Default  | Description                                              |
| -------------- | --------- | -------- | -------------------------------------------------------- |
| `name`         | `string`  | required |                                                          |
| `sm`           | `boolean` | `false`  | 18px inline tile                                         |
| `checkMissing` | `boolean` | `false`  | Show the "not on disk" state                             |
| `strict`       | `boolean` | `false`  | Trust the listing's preview flag (default is optimistic) |

## LoraDetail

Everything about one LoRA: cover, chips, bookmark, Civitai link, trigger words (click to copy),
example gallery (mature blur), parameters, tags, description, notes and training metadata. Opens
examples in ZenLightbox.

```vue
<LoraDetail :name="lora" pickable @pick="use" />
```

| Prop       | Type      | Default  | Description         |
| ---------- | --------- | -------- | ------------------- |
| `name`     | `string`  | required |                     |
| `pickable` | `boolean` | `false`  | Show a "Use" button |

| Event  | Payload  |
| ------ | -------- |
| `pick` | `string` |

Examples show in a viewer: the chosen one large (‹ › or ←/→, Home/End; click for fullscreen), a filmstrip of them all beneath that keeps the chosen one in view (the wheel scrolls it sideways), and its generation details beside it when the panel is wider than about 560px. Example and page URLs come from the LoRA's metadata, so they pass `safeMediaUrl` / `safeLinkUrl` first; anything else shows nothing.
