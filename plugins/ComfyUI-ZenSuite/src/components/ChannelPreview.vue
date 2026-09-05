<template>
  <!-- `fill` — and it must match the widget's registration (see mountNodeControls). The node's
       height belongs to whoever drags it; the grid scrolls inside whatever it's given. Before
       this the node was content-sized, so turning `Show` up grew it to a thousand pixels. -->
  <ZenWidget ref="shell" class="zcp" fill :gap="0" :pad="false">
    <!-- Settings (cog-toggled): channel + range (show/skip).
         ZenRow/ZenField rather than hand-rolled flex rows. A node body is ~300px wide and plain
         flex shrinks its children past the point of usefulness, which is what left these controls
         clipped and their labels ellipsised. ZenRow gives `data-grow` children the row's `min` as
         their flex BASIS, so when there's no longer room they WRAP to the next line instead of
         squashing — the row gets taller and the node grows with it. -->
    <div v-if="showOpts" class="zcp-opts">
      <ZenRow :min="150">
        <ZenField label="Channel" data-grow>
          <ZenSelect
            :model-value="channel"
            :options="chanOptions"
            placeholder="✦ Most recent"
            @update:model-value="(v) => setChannel(String(v))"
          />
        </ZenField>
        <!-- Clear lives beside the channel it clears, rather than sitting permanently on display
             in a footer: it's a rare, destructive action, so the cog is the right place for it. -->
        <ZenIconButton
          icon="mdi mdi-delete-sweep-outline"
          danger
          :disabled="!history.length"
          title="Clear the wall"
          @click="clear"
        />
      </ZenRow>

      <!-- Show/Skip are `stack`ed and NOT `data-grow`, and both halves matter for fitting a
           narrow node:
             not grown  — they hold a number up to 32, so stretching them just makes a wide box
                          with a digit adrift in it, and the pair resize on every width change.
             stacked    — the label sits ABOVE, so each field needs the width of its control
                          (74px) rather than label + gap + control (~114px). Inline labels were
                          what pushed these past the node's edge on a narrow node: a fixed-size
                          flex child can't shrink, so once it no longer fits it OVERFLOWS rather
                          than wrapping — and a node body doesn't clip, so it spilled outside.
           At 74px each they wrap onto their own lines long before that can happen. -->
      <ZenRow :gap="8">
        <ZenField label="Show" stack>
          <ZenNumber
            :model-value="count"
            :min="1"
            :max="MAX"
            :step="1"
            :precision="0"
            @update:model-value="setCount"
          />
        </ZenField>
        <ZenField label="Skip" stack>
          <ZenNumber
            :model-value="skip"
            :min="0"
            :max="MAX"
            :step="1"
            :precision="0"
            @update:model-value="setSkip"
          />
        </ZenField>
        <ZenField label="Layout" stack>
          <ZenToggleGroup
            :model-value="layout"
            :options="LAYOUTS"
            @update:model-value="(v) => setLayout(String(v))"
          />
        </ZenField>
      </ZenRow>
    </div>

    <!-- The wall — images at true aspect ratio, scrolling inside the node (down, or sideways).
         The stage wrapper is both the scroll viewport's parent and the chip's anchor: an
         absolutely-positioned child inside the scroller would travel with the content. -->
    <div v-if="shown.length" class="zcp-stage">
      <span class="zcp-chip">
        {{ channel || 'most recent' }}
        <span class="zcp-chip-n">{{ rangeLabel }}</span>
      </span>
      <div :class="['zcp-wall', isRow ? 'is-row' : 'is-col']">
        <button
          v-for="it in shown"
          :key="it.n"
          class="zcp-cell"
          :title="cellTitle(it)"
          @click="openAt(it)"
        >
          <video
            v-if="it.kind === 'video'"
            :src="it.url + '#t=0.1'"
            :style="mediaStyle(it)"
            muted
            preload="metadata"
            playsinline
            @loadedmetadata="onMedia"
          />
          <i v-else-if="it.kind === 'audio'" class="mdi mdi-music-note zcp-audio" />
          <img
            v-else
            :src="it.url"
            :style="mediaStyle(it)"
            alt=""
            draggable="false"
            @load="onMedia"
          />
          <i v-if="it.kind === 'video'" class="mdi mdi-play-circle zcp-badge" />
        </button>
      </div>
    </div>
    <div v-else class="zcp-empty">
      <i class="mdi mdi-image-multiple-outline zcp-empty-ic" />
      <span class="zcp-empty-t">{{ emptyTitle }}</span>
      <span class="zcp-empty-s">{{ emptySub }}</span>
    </div>
  </ZenWidget>
</template>

<script setup lang="ts">
// The on-graph twin of the Media Viewer: a rolling wall of recent images on a channel.
// Mounted onto a zen.Channel.Preview node; settings come from the node's own widgets.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  ZenField,
  ZenIconButton,
  ZenNumber,
  ZenRow,
  ZenSelect,
  ZenToggleGroup,
  ZenWidget,
} from '@nynxz/zenkit-ui'
import { getZenKit, openViewer, type ChannelImage, type ViewerItem } from '@nynxz/zenkit-client'
import { addNodeHeaderButton, type NodeHeaderButtonHandle } from '@/lib/headerButton'

interface Widget {
  value: unknown
  callback?: (v: unknown) => void
}
interface NodeLike {
  setDirtyCanvas?: (a: boolean, b: boolean) => void
  graph?: { setDirtyCanvas?: (a: boolean, b: boolean) => void }
}
const props = defineProps<{
  node: NodeLike
  channelWidget: Widget
  countWidget: Widget
  skipWidget?: Widget
  layoutWidget?: Widget
}>()

const LAYOUTS = [
  {
    value: 'column',
    icon: 'mdi mdi-view-agenda-outline',
    title: 'Column — full-width images, scrolls down',
  },
  { value: 'row', icon: 'mdi mdi-view-week-outline', title: 'Row — a strip, scrolls sideways' },
]
const MAX = 32 // matches the Python `count`/`skip` caps
const BUFFER = 64 // internal history cap (must cover skip + count)
const zen = getZenKit()
// A `ref` on a COMPONENT resolves to its instance, not its element, so the cog helper — which
// walks up from an element inside the node to find its header — needs the element ZenWidget
// exposes rather than the proxy.
const shell = ref<{ el: HTMLElement | null } | null>(null)
const showOpts = ref(false)

const channel = ref(typeof props.channelWidget.value === 'string' ? props.channelWidget.value : '')
const count = ref(clampInt(props.countWidget.value, 4, 1))
const skip = ref(clampInt(props.skipWidget?.value, 0, 0))
const layout = ref(props.layoutWidget?.value === 'row' ? 'row' : 'column')
const isRow = computed(() => layout.value === 'row')

function clampInt(v: unknown, dflt: number, min = 0, max = MAX): number {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : dflt
}

// Our own newest-first history (the bus only holds the latest per channel). `n` is a
// stable key. We keep up to BUFFER and render the window [skip, skip+count), so the
// node shows a range of previous generations, not just the very latest.
interface HItem extends ChannelImage {
  n: number
}
const history = ref<HItem[]>([])
let counter = 0
const shown = computed(() => history.value.slice(skip.value, skip.value + count.value))

function redraw() {
  ;(props.node.setDirtyCanvas ?? props.node.graph?.setDirtyCanvas)?.(true, true)
}
function writeWidget(w: Widget | undefined, v: unknown) {
  if (!w) return
  w.value = v
  try {
    w.callback?.(v)
  } catch {
    /* widget has no callback */
  }
  redraw()
}
function setChannel(v: string) {
  channel.value = v
  writeWidget(props.channelWidget, v)
  reseed()
}
function setCount(v: number) {
  count.value = clampInt(v, 4, 1)
  writeWidget(props.countWidget, count.value)
}
function setLayout(v: string) {
  layout.value = v === 'row' ? 'row' : 'column'
  writeWidget(props.layoutWidget, layout.value)
}
function setSkip(v: number) {
  skip.value = clampInt(v, 0, 0)
  writeWidget(props.skipWidget, skip.value)
}

function push(img: ChannelImage) {
  history.value = [{ ...img, n: ++counter }, ...history.value].slice(0, BUFFER)
}
function reseed() {
  history.value = []
  counter = 0
  const seed = zen?.channels.get(channel.value.trim() || '$last')
  if (seed) push(seed)
}
function clear() {
  history.value = []
}

// Reserve each cell's box from the known dimensions so it lands at the right size
// before the media loads (no reflow jank); the layout CSS supplies the other axis.
function mediaStyle(it: HItem) {
  return it.width && it.height ? { aspectRatio: `${it.width} / ${it.height}` } : {}
}
// Media finishing load can change the wall height → let mountNodeControls' ResizeObserver
// re-fit the node, and repaint.
function onMedia() {
  redraw()
}

// --- empty state / range label ---
const emptyTitle = computed(() =>
  !zen
    ? 'ComfyUI-ZenKit required'
    : skip.value && history.value.length
      ? 'Nothing older yet'
      : 'Waiting for images…',
)
const emptySub = computed(() => {
  if (!zen) return 'Install the ZenKit runtime to see channel previews.'
  if (skip.value && history.value.length)
    return `Skipping the ${skip.value} most recent — generate more to fill this range.`
  // Says "fills as you generate" rather than implying a backlog is waiting to be loaded: the
  // wall only holds what it has seen since the page loaded (see the header).
  return 'Run a Zen Sync Image node on this channel — the wall fills as you generate.'
})
const rangeLabel = computed(() =>
  skip.value
    ? `${skip.value + 1}–${skip.value + shown.value.length}`
    : `${shown.value.length}/${count.value}`,
)

// --- channel picker options: "most recent" + channels seen on the bus + current pick ---
const chanOptions = computed(() => {
  const set = new Set<string>()
  if (zen) for (const n of zen.channels.list()) set.add(n)
  for (const it of history.value) if (it.channel) set.add(it.channel)
  if (channel.value) set.add(channel.value)
  return [{ value: '', label: '✦ Most recent' }, ...[...set].map((n) => ({ value: n, label: n }))]
})

// --- viewer / labels ---
function timeOf(ts: number) {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
function dims(it: HItem) {
  return it.width ? `${it.width} × ${it.height}` : ''
}
function cellTitle(it: HItem) {
  return [it.channel || '', timeOf(it.ts)].filter(Boolean).join(' — ')
}
function openAt(it: HItem) {
  const items: ViewerItem[] = shown.value.map((h) => ({
    src: h.url,
    kind: h.kind || 'image',
    label: h.channel || 'image',
    meta: [dims(h), timeOf(h.ts)].filter(Boolean).join('  ·  '),
  }))
  const idx = shown.value.findIndex((h) => h.n === it.n)
  void openViewer(items, { index: idx < 0 ? 0 : idx })
}

// Re-read after a frame so values restored by node.configure() (loading a saved
// workflow) land in the refs even if they arrive just after mount.
function resync() {
  if (typeof props.channelWidget.value === 'string') channel.value = props.channelWidget.value
  count.value = clampInt(props.countWidget.value, 4, 1)
  skip.value = clampInt(props.skipWidget?.value, 0, 0)
  layout.value = props.layoutWidget?.value === 'row' ? 'row' : 'column'
}

let cog: NodeHeaderButtonHandle | null = null
const unsubs: Array<() => void> = []
onMounted(() => {
  resync()
  if (zen) {
    unsubs.push(
      zen.channels.subscribe('$last', (img) => {
        const target = channel.value.trim()
        if (!target || img.channel === target) push(img)
      }),
    )
  }
  reseed()
  requestAnimationFrame(() => {
    resync()
    reseed()
  })
  cog = addNodeHeaderButton(props.node, shell.value?.el ?? null, {
    icon: 'mdi mdi-cog',
    text: '⚙',
    title: 'Preview settings (channel / range / layout)',
    onClick: () => {
      showOpts.value = !showOpts.value
    },
  })
  cog.setActive(showOpts.value)
})
watch(showOpts, (v) => cog?.setActive(v))
onBeforeUnmount(() => {
  cog?.destroy()
  for (const u of unsubs) u()
})
</script>

<style scoped>
/* ZenWidget supplies the flex column, padding, box-sizing, baseline type and the `cursor: default`
   that stops the node's grab-hand bleeding into the body. Only the font family is ours. */
.zcp {
  font-family: var(--p-font-family, system-ui, sans-serif);
}

/* settings — same padding as before the migration; ZenRow/ZenField own the widths and wrapping */
.zcp-opts {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 4px 8px;
}

/* the wall */
/* The viewport: takes the height the node gives it and scrolls, so the node never grows to fit
   its own contents. `min-height: 0` is the load-bearing half — without it this flex child's
   intrinsic height wins and the grid pushes out of the node instead of scrolling. */
.zcp-stage {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
}
/* Replaces the footer strip: the same two facts (which channel, how much of it), floated over
   the images instead of costing a bordered row of node height. */
.zcp-chip {
  position: absolute;
  top: 5px;
  left: 5px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: calc(100% - 14px);
  padding: 2px 7px;
  border-radius: var(--zen-radius, 6px);
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 10.5px;
  line-height: 1.5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  /* never intercept a click meant for the image underneath */
  pointer-events: none;
}
.zcp-chip-n {
  opacity: 0.75;
  font-variant-numeric: tabular-nums;
}
/* The viewport is a definite box (the node's height, via fill), which is what lets BOTH layouts
   size themselves from the node instead of from a setting. */
.zcp-wall {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  gap: 6px;
  padding: 4px;
}
/* Column: full-width images at true aspect ratio, scrolling down. A wider node means a bigger
   picture. */
.zcp-wall.is-col {
  flex-direction: column;
  overflow-y: auto;
  overflow-x: hidden;
}
.zcp-wall.is-col .zcp-cell {
  position: relative;
  flex: 0 0 auto;
  display: block;
  padding: 0;
  border: 1px solid var(--zen-border, rgba(255, 255, 255, 0.09));
  border-radius: var(--zen-radius, 6px);
  overflow: hidden;
  cursor: pointer;
  background: var(--zen-input, #15151a);
  transition: border-color 0.12s ease;
}
.zcp-wall.is-col .zcp-cell > img,
.zcp-wall.is-col .zcp-cell > video {
  width: 100%;
  height: auto;
}
.zcp-wall.is-col .zcp-audio {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26px;
  color: var(--zen-muted, #9aa0aa);
}
/* Row: a strip whose height IS the viewport's, so dragging the node taller makes the images
   bigger and each one keeps its aspect ratio. This is what the old `row_height` slider was
   trying to be — the node's own size, rather than a number you had to keep tuning. */
.zcp-wall.is-row {
  flex-direction: row;
  align-items: stretch;
  overflow-x: auto;
  overflow-y: hidden;
}
.zcp-wall.is-row .zcp-cell {
  height: 100%;
  width: auto;
}
.zcp-wall.is-row .zcp-cell > img,
.zcp-wall.is-row .zcp-cell > video {
  height: 100%;
  width: auto;
}
.zcp-wall.is-row .zcp-audio {
  height: 100%;
  width: 96px;
}
/* a slim scrollbar for the strip */
.zcp-wall.is-row::-webkit-scrollbar {
  height: 7px;
}
.zcp-wall.is-row::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--zen-text, #fff) 18%, transparent);
  border-radius: 4px;
}

.zcp-cell {
  position: relative;
  flex: 0 0 auto;
  display: block;
  width: 100%;
  padding: 0;
  border: 1px solid var(--zen-border, rgba(255, 255, 255, 0.09));
  border-radius: var(--zen-radius, 6px);
  overflow: hidden;
  cursor: pointer;
  background: var(--zen-input, #15151a);
  transition: border-color 0.12s ease;
}
.zcp-cell:hover {
  border-color: var(--zen-accent, #7aa2ff);
}
.zcp-cell > img,
.zcp-cell > video {
  display: block;
  object-fit: contain;
}

/* column: each image fills the node width, height follows its aspect ratio */

/* row: strip height (set by the Height slider), width follows the aspect ratio, scroll sideways */

.zcp-audio {
  display: flex;
  width: 100%;
  height: 64px;
  align-items: center;
  justify-content: center;
  font-size: 26px;
  color: var(--zen-muted, #9aa0aa);
}
.zcp-badge {
  position: absolute;
  top: 3px;
  left: 4px;
  font-size: 15px;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85);
  pointer-events: none;
}

/* a slim scrollbar for the row */

/* empty state — takes the viewport's height so it centres in a fill node instead of sitting in
   a band at the top with dead space beneath it */
.zcp-empty {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  text-align: center;
  padding: 22px 12px;
  color: var(--zen-muted, #9aa0aa);
}
.zcp-empty-ic {
  font-size: 34px;
  opacity: 0.5;
  margin-bottom: 2px;
}
.zcp-empty-t {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--zen-text, #e5e5ea);
}
.zcp-empty-s {
  font-size: 11px;
  opacity: 0.8;
  max-width: 230px;
  line-height: 1.35;
}
</style>
