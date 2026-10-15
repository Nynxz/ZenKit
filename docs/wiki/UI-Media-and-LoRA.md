# UI: media and LoRA

Viewers, players, pickers and timelines, plus the LoRA picker family. Part of
[`@nynxz/zenkit-ui`](UI-Components.md).

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

## ZenPeek

Hold Shift over a thumbnail to see it large, in a small floating window beside it: a picture at
full size, a video playing (muted, looped), audio with a player, or content your component draws.
Releasing Shift, Escape, moving off the thumbnail or starting a drag puts it away.

Drop one `<ZenPeek />` inside the area it should cover. It watches the elements in that area
(its parent element) that carry these attributes:

| Attribute          | Description                                                         |
| ------------------ | ------------------------------------------------------------------- |
| `data-peek`        | The media URL to show                                               |
| `data-peek-kind`   | `image`, `video`, `audio` (else guessed from the URL), or `custom`  |
| `data-peek-id`     | With `custom`: your id for what to draw (falls back to `data-peek`) |
| `data-peek-label`  | The caption's title                                                 |
| `data-peek-detail` | The caption's second line                                           |

```vue
<div class="grid">
  <img v-for="a in assets" :key="a.url" :src="a.thumb" :data-peek="a.url" :data-peek-label="a.name" />
  <ZenPeek />
</div>
```

| Prop     | Type         | Default | Description                                                       |
| -------- | ------------ | ------- | ----------------------------------------------------------------- |
| `render` | `PeekRender` | —       | Draws `custom` content into the window (see below)                |
| `focus`  | `boolean`    | `false` | Also peek at the focused element when Shift is pressed (keyboard) |

### Custom content

For something that isn't a media file (a live shader preview, a chart, a rendered card), mark the
element `data-peek-kind="custom"` with a `data-peek-id`, and fill the window either with the
`custom` slot or the `render` callback. The window chrome, placement beside the element, caption,
z-layer and Escape handling are the same as for media.

```vue
<!-- A slot: Vue content, given the id and the element. -->
<ZenPeek>
  <template #custom="{ id }"><MyCard :item="byId(id)" /></template>
</ZenPeek>

<!-- A callback: imperative content (a canvas, WebGL). -->
<ZenPeek :render="draw" focus />
```

```ts
import type { PeekRender } from '@nynxz/zenkit-ui'

const draw: PeekRender = (id, container, { el, reducedMotion, place }) => {
  const canvas = document.createElement('canvas')
  container.append(canvas)
  let raf = 0
  const tick = (now: number) => {
    paint(canvas, id, now)
    if (!reducedMotion) raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
  return () => cancelAnimationFrame(raf) // runs when the peek closes or moves to another element
}
```

`render(id, container, ctx)` is called once per peek, after the window is in the page; the
function it returns is called when the peek closes, moves to another element, or ZenPeek unmounts.
Release everything there (animation frames, GL contexts, listeners). `ctx`:

| Field           | Description                                                           |
| --------------- | --------------------------------------------------------------------- |
| `el`            | The element being peeked at                                           |
| `reducedMotion` | The system asks for reduced motion: draw a still instead of animating |
| `place()`       | Re-place the window; it also re-places itself when its size changes   |

The content sets its own size, up to `min(560px, 60vw)` × `min(480px, 70vh)`. With the slot
and `render` both given, both run (the slot's content first, inside the same container).

While it's open the peek is the top floating layer: Escape closes it (not the window or modal
under it) and it stays closed until Shift is pressed again. Its opening animation follows
`--zen-dur-fast`, and is off under reduced motion.

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

Clips on a track that touch (one ends where the next begins, to within half a pixel) read as two:
their inner corners are square and the later one starts with a seam, a hairline in `--ztl-seam`
(the theme's text colour at 62%) with a small notch top and bottom, as an editor marks a cut.
Clips being dragged don't join until they're dropped.

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

| Prop          | Type                                     | Default   | Description                                                                                                                                                                                                                             |
| ------------- | ---------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `duration`    | `number`                                 | required  | Seconds                                                                                                                                                                                                                                 |
| `tracks`      | `TimelineTrack[]`                        | required  |                                                                                                                                                                                                                                         |
| `selected`    | `string \| string[] \| null`             | `null`    | Selected item id(s)                                                                                                                                                                                                                     |
| `snap`        | `number`                                 | `0.05`    | Seconds                                                                                                                                                                                                                                 |
| `guides`      | `number[]`                               | `[]`      | Vertical lines through every track (e.g. scene boundaries)                                                                                                                                                                              |
| `range`       | `{ start: number; end: number } \| null` | `null`    | Highlighted range                                                                                                                                                                                                                       |
| `headWidth`   | `number`                                 | `112`     | Track header width in px                                                                                                                                                                                                                |
| `magnet`      | `number \| false`                        | `6`       | Magnetic snapping in px: a moved item's edges, a trimmed edge or a drop catch on other items' edges, the playhead and `snapPoints`, with a line while caught. Alt held while dragging skips it. Otherwise times fall on the `snap` grid |
| `snapPoints`  | `number[]`                               | `[]`      | Extra snap targets (markers, beats)                                                                                                                                                                                                     |
| `headActions` | `'below' \| 'inline'`                    | `'below'` | Where a track header's `actions` go: on a line under the name, or beside it (faint until hovered)                                                                                                                                       |
| `marquee`     | `boolean`                                | `false`   | A drag on empty track space selects the clips in a box (`marquee` event) instead of scrubbing; the ruler still scrubs                                                                                                                   |

| Event      | Payload                                      | Description                                                                                           |
| ---------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `select`   | `(itemId \| null, trackId, PointerEvent)`    | Curve tracks send `'curve:<trackId>'` as the id                                                       |
| `open`     | `(itemId, trackId)`                          | Double-click on an item                                                                               |
| `move`     | `(itemId, trackId, { start?, end? })`        | Drag or resize                                                                                        |
| `context`  | `(target: TimelineTarget, time, MouseEvent)` | Right-click                                                                                           |
| `drop`     | `(trackId, time, DragEvent)`                 | Something dropped on a track                                                                          |
| `dblclick` | `(trackId, time)`                            | Double-click on empty track space                                                                     |
| `reorder`  | `(trackId, beforeId \| null)`                | A movable track header was dragged                                                                    |
| `curve`    | `(trackId, points: { t, v }[])`              | Curve edited                                                                                          |
| `level`    | `(trackId, segmentId, v \| null)`            | Level segment changed                                                                                 |
| `shape`    | `(trackId, segmentId, points: { x, y }[])`   | Segment shape changed                                                                                 |
| `action`   | `(trackId, actionId)`                        | Header action clicked                                                                                 |
| `marquee`  | `(itemIds: string[])`                        | The selection a box drag makes, as it changes: what it touches, plus (Shift/Ctrl/⌘) what was selected |

Exposed: `timeAt(clientX): number`, `follow()` (scroll the playhead into view).

The wheel pans a zoomed-in timeline; Ctrl/⌘ (or Alt) + wheel zooms, keeping the time under the
pointer where it is. Inside a ComfyUI node the canvas would take Ctrl + wheel and sideways swipes
for itself, so the timeline listens for the wheel first: over its tracks, while the node has focus
(ComfyUI's `data-capture-wheel` rule), they're the timeline's. A `zoom` set from outside (a slider)
keeps the playhead where it is on screen. Scrolling doesn't re-render the tracks.

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

| Field                                      | Type                                    | Description                                                                                                                                                                               |
| ------------------------------------------ | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                       | `string`                                |                                                                                                                                                                                           |
| `start`, `end`                             | `number`, `number?`                     | Seconds. A marker uses only `start`.                                                                                                                                                      |
| `kind`                                     | `'clip' \| 'marker'`                    |                                                                                                                                                                                           |
| `label`, `title`, `color`, `thumb`, `icon` | `string?`                               |                                                                                                                                                                                           |
| `muted`                                    | `boolean?`                              |                                                                                                                                                                                           |
| `ghost`                                    | `boolean?`                              | Placeholder slot: dashed, not draggable                                                                                                                                                   |
| `resize`                                   | `'start' \| 'end' \| 'both' \| false`   | Draggable edges (clips default `'end'`)                                                                                                                                                   |
| `movable`                                  | `boolean?`                              | Markers default yes, clips no                                                                                                                                                             |
| `commit`                                   | `'live' \| 'drop'`                      | `'drop'` emits one `move` on release instead of on every step                                                                                                                             |
| `progress`                                 | `number?`                               | 0–1 progress fill along the bottom edge                                                                                                                                                   |
| `group`                                    | `string?`                               | Items sharing a group move together (a video and its sound): a drag shows them following, and they never snap to each other. A selected item drags the rest of the selection the same way |
| `peek`                                     | `{ src?, kind?, id?, label?, detail? }` | What Shift shows (ZenPeek): a media `src`, or `kind: 'custom'` with an `id` the host's ZenPeek draws                                                                                      |
| `frames`, `framesAspect`                   | `(t) => string?`, `number?`             | A filmstrip under the label: the picture at each timeline time, asked only for the frames near the view                                                                                   |
| `wave`                                     | `number[]?`                             | A waveform under the label: peaks 0–1, evenly across the clip                                                                                                                             |
| `badges`                                   | `string[]?`                             | Short tags after the label                                                                                                                                                                |
| `marks`                                    | `{ t, label?, strong? }[]?`             | Lines across the clip at timeline times (where its source changes scene, say)                                                                                                             |
| `tracks`                                   | `string[]?`                             | Other tracks it can be dragged onto (with `commit: 'drop'`); `move` then names the track it was let go on                                                                                 |

`TimelineTarget`: `{ trackId: string; itemId?: string }`.

## ZenBoxCanvas

Boxes over a canvas: drag on empty canvas to draw one, drag a box to move it, drag a handle to
resize it, and paint a mask inside one. The host owns the boxes and decides what a drawn rect
becomes — the canvas reports it through `create` and adds nothing itself.

Geometry is in 0..1 of the canvas (`x`/`w` of its width, `y`/`h` of its height), so boxes survive
a resolution change. The stage contain-fits whatever space it is given, at `aspect`.

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { ZenBoxCanvas, type BoxTool, type ZenBox } from '@nynxz/zenkit-ui'

const boxes = ref<ZenBox[]>([])
const selected = ref<string[]>([])
const tool = ref<BoxTool>('select')
let n = 0

function add(rect: { x: number; y: number; w: number; h: number }) {
  const id = `b${++n}`
  boxes.value = [...boxes.value, { id, ...rect, label: `Box ${n}`, color: '#4fb8ff' }]
  selected.value = [id]
}
function save() {
  localStorage.setItem('boxes', JSON.stringify(boxes.value))
}
function setMask(id: string, mask: string | null) {
  boxes.value = boxes.value.map((b) => (b.id === id ? { ...b, mask } : b))
}
</script>

<template>
  <div style="height: 400px">
    <ZenBoxCanvas
      v-model:boxes="boxes"
      v-model:selected="selected"
      v-model:tool="tool"
      :aspect="16 / 9"
      @create="add"
      @update:mask="setMask"
      @commit="save"
      @delete="(ids) => (boxes = boxes.filter((b) => !ids.includes(b.id)))"
    />
  </div>
</template>
```

- **Live and committed edits.** `update:boxes` fires on every pointer move so the host can draw;
  `commit` fires once when a move, resize, nudge or stroke ends. Persist on `commit`.
- **Selection.** Click a box; Shift/Ctrl-click to add or remove; Shift-drag on empty canvas for a
  marquee. Where boxes overlap, a click that doesn't move steps down through them, Alt
  goes straight to the one under the selection, and the selected box's handles sit above every box
  so a covered box can still be resized. Two or more selected get a group frame whose handles scale them together.
- **Masks.** `tool` `brush` (key `B`) paints into the selected box, `erase` (`E`) removes, `V`
  goes back to select. A mask is box-local — a PNG data URL whose alpha is the shape, stretched over
  the box, so it moves and scales with it. `update:mask` hands it over when a stroke ends, or `null`
  when the stroke left the whole box covered. No mask means the whole box. `maskClips: false` keeps the box
  drawn whole and hands the mask only to the `box` slot's `maskStyle` — for a shape that marks
  something inside the box rather than the box itself. `maskView` is what the canvas shows in place
  of the mask (a grown or processed view of it); painting and resizing still work on `mask`.
- **Keys.** Delete/Backspace emits `delete`, arrows nudge (Shift for more), Escape deselects,
  Ctrl+A selects all. Handled keys stop there, so the graph doesn't also act on them.
- **Modifiers.** Shift keeps a box's on-screen shape while resizing and locks a move to one axis;
  Alt suspends `snap`.

| Prop              | Type             | Default |                                                    |
| ----------------- | ---------------- | ------- | -------------------------------------------------- |
| `aspect`          | `number`         | `1`     | Canvas width / height.                             |
| `backdrop`        | `string \| null` | `null`  | Image under the boxes.                             |
| `backdropOpacity` | `number`         | `1`     |                                                    |
| `draw`            | `boolean`        | `true`  | Dragging on empty canvas draws a box.              |
| `snap`            | `number`         | `0`     | Snap edges to multiples of this fraction.          |
| `brushSize`       | `number`         | `0.06`  | Brush diameter, as a fraction of the canvas width. |
| `brushSoftness`   | `number`         | `0.15`  | 0 hard to 1 soft.                                  |
| `showLabels`      | `boolean`        | `true`  | The number-and-label tag on each box.              |
| `grid`            | `number`         | `0`     | Faint grid lines every this fraction.              |
| `minSize`         | `number`         | `0.02`  | Smallest box `create` reports.                     |

Slots: `box` (`{ box, index, maskStyle }` — drawn inside each box; spread `maskStyle` onto
whatever should be clipped to the painted shape; a size container, so content can respond to the
box's size), `empty` (shown with no visible boxes),
`overlay` (anything drawn over the stage).
`open` fires on a double-click on a box. The pure geometry (`resizeRect`, `moveRect`, `boxAt`, …)
is exported for hosts that edit boxes elsewhere.

## ZenLayerList

The stack beside a ZenBoxCanvas: pick a layer, hide it, lock it, drag it up or down. The host
passes the rows top-first and owns the order — a drag reports `reorder(id, index)` with the
display position it should move to. `pinned` rows (a background) have no grip and nothing can be
dropped past them.

```vue
<ZenLayerList
  v-model:selected="selected"
  :items="[
    { id: 'hat', label: 'Hat', color: '#f05a5a', sub: '1 LoRA' },
    { id: 'bg', label: 'Background', pinned: true },
  ]"
  @reorder="(id, index) => move(id, index)"
  @toggle-hidden="(id) => toggle(id)"
/>
```

Rows take a `color` swatch or a `thumb` image, and a dimmer `sub` line. The `actions` slot adds
buttons to a row; `lockable` (default on) shows the lock toggle.

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
