<script setup lang="ts">
// Media Viewer — the merged Compare + SyncView panel, driven by ZenKit's channel
// image bus. One panel, two modes:
//   • view    — the live feed of one channel (or $last = most recent on any
//               channel): an inline ZenLightbox stage + history strip + slideshow.
//   • compare — two channels side-by-side under a draggable split slider.
// Multi-instance: open several viewers, each watching a different channel. Per-
// instance state (mode, channels, thumbs, slideshow) is persisted via PanelContext.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  ZenLightbox,
  ZenMediaControls,
  ZenSelect,
  ZenToggleGroup,
  type LightboxItem,
} from '@nynxz/zenkit-ui'
import {
  getZenKit,
  hasImageDragData,
  readImageDragData,
  readMediaListDrop,
  setImageDragData,
  ZEN_MEDIA_LIST_MIME,
  type ChannelImage,
  type PanelContext,
} from '@nynxz/zenkit-client'

const MODE_OPTIONS = [
  { value: 'view', icon: 'mdi mdi-image-outline', title: 'Single / live view' },
  { value: 'compare', icon: 'mdi mdi-compare', title: 'Compare two channels' },
]

const props = defineProps<{ ctx?: PanelContext }>()
const zen = getZenKit()

type Mode = 'view' | 'compare'

// --- persisted per-instance state ------------------------------------------
const saved = (props.ctx?.state as Record<string, unknown>) || {}
const mode = ref<Mode>(saved.mode === 'compare' ? 'compare' : 'view')
const chan = ref<string>(typeof saved.chan === 'string' ? saved.chan : '')
const chanA = ref<string>(typeof saved.chanA === 'string' ? saved.chanA : '')
const chanB = ref<string>(typeof saved.chanB === 'string' ? saved.chanB : '')
const showThumbs = ref<boolean>(saved.showThumbs !== false)
const slideMs = ref<number>(typeof saved.slideMs === 'number' ? saved.slideMs : 3000)
/** In a slideshow, videos and audio play to the end; the interval is for pictures. */
const slideToEnd = ref<boolean>(saved.slideToEnd !== false)
// Full-panel: the media alone, no header / footer / strip. Per-instance, so one viewer can be
// full while another stays chromed.
const full = ref<boolean>(saved.full === true)

// --- channel state ----------------------------------------------------------
// byName/last mirror the bus (reactively) for the compare URLs + the datalist;
// `history` is this viewer's own newest-first feed for the selected channel.
const byName = ref<Record<string, ChannelImage>>({})
const last = ref<ChannelImage | null>(null)
const names = computed(() => Object.keys(byName.value))

// Not following any channel: the viewer shows only what is dropped or sent into it.
const NO_FEED = '\u0000none'
/** The channel this viewer follows ('$last' for the most recent on any), or null for none. */
const feedOf = (): string | null => (chan.value === NO_FEED ? null : chan.value.trim() || '$last')

// Channel dropdown options: a "Most recent" default + the channels actually seen on
// the bus + whatever's currently selected (so a persisted pick survives). No more
// free-form typing, and no arbitrary preset names.
const chanOptions = computed(() => {
  const set = new Set<string>(names.value)
  for (const v of [chan.value, chanA.value, chanB.value]) if (v && v !== NO_FEED) set.add(v)
  return [
    { value: '', label: '✦ Most recent' },
    { value: NO_FEED, label: '⊘ Only what is sent here' },
    ...[...set].map((n) => ({ value: n, label: n })),
  ]
})

interface HItem extends ChannelImage {
  n: number // stable key (survives reorder/removal)
  /** Dropped in by hand rather than arriving on the bus — survives a channel switch. */
  dropped?: boolean
}
let counter = 0
const MAX_HISTORY = 50

// The feed and selection persist with the rest, so a reload or a move (dock, pin, pop out)
// brings back what was showing. Local files dropped in live at blob: URLs that die with the
// page, so they are left out.
type SavedItem = ChannelImage & { dropped?: boolean }
const isSavedItem = (v: unknown): v is SavedItem =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as SavedItem).url === 'string' &&
  typeof (v as SavedItem).channel === 'string'
const history = ref<HItem[]>(
  (Array.isArray(saved.history) ? saved.history : [])
    .filter(isSavedItem)
    .map((it) => ({ ...it, n: ++counter })),
)
const selectedN = ref<number | null>(
  history.value[typeof saved.selected === 'number' ? saved.selected : 0]?.n ?? null,
)

watch([mode, chan, chanA, chanB, showThumbs, slideMs, slideToEnd, full, history, selectedN], () => {
  const kept = history.value.filter((it) => !it.url.startsWith('blob:'))
  props.ctx?.setState({
    mode: mode.value,
    chan: chan.value,
    chanA: chanA.value,
    chanB: chanB.value,
    showThumbs: showThumbs.value,
    slideMs: slideMs.value,
    slideToEnd: slideToEnd.value,
    full: full.value,
    history: kept.map(({ n: _n, ...it }) => it),
    selected: Math.max(
      0,
      kept.findIndex((it) => it.n === selectedN.value),
    ),
  })
})

// The cap bounds what the channels stream in; things you dropped here stay until you remove them
// (a dropped gallery can be hundreds of images).
function pushHistory(img: ChannelImage, dropped = false) {
  pushAll([img], dropped)
}
function pushAll(imgs: ChannelImage[], dropped = false) {
  if (!imgs.length) return
  const added: HItem[] = imgs.map((img) => ({ ...img, n: ++counter, dropped }))
  let streamed = 0
  const next = [...added, ...history.value]
  const kept = next.filter((it) => it.dropped || ++streamed <= MAX_HISTORY)
  for (const gone of next) if (!kept.includes(gone)) forget(gone) // don't pin blobs that scrolled off
  history.value = kept
  selectedN.value = added[0]!.n // the first of what just arrived is the one shown
}
function reseedView() {
  // Dropped items never came from the bus, so a channel switch must not sweep them away.
  // `counter` stays monotonic for the same reason — resetting it would collide their keys.
  const kept = history.value.filter((i) => i.dropped)
  for (const gone of history.value) if (!gone.dropped) forget(gone)
  history.value = kept
  selectedN.value = kept[0]?.n ?? null
  if (!zen) return
  const feed = feedOf()
  const seed = feed && zen.channels.get(feed)
  if (seed) pushHistory(seed)
}
watch(chan, reseedView)

const unsubs: Array<() => void> = []
onMounted(() => {
  if (!zen) return
  for (const name of zen.channels.list()) {
    const r = zen.channels.get(name)
    if (r) byName.value[name] = r
  }
  last.value = zen.channels.last()
  // One subscription to every publish ($last): update the mirror, and append to
  // this viewer's history when the image is on the channel it's watching.
  unsubs.push(
    zen.channels.subscribe('$last', (img) => {
      byName.value = { ...byName.value, [img.channel]: img }
      last.value = img
      const feed = feedOf()
      if (feed === '$last' || img.channel === feed) pushHistory(img)
    }),
  )
  // A restored feed is kept; only an image published while the viewer was away is added.
  if (!history.value.length) reseedView()
  else {
    const feed = feedOf()
    const seed = feed && zen.channels.get(feed)
    if (seed && !history.value.some((it) => it.url === seed.url)) pushHistory(seed)
  }
})
onBeforeUnmount(() => {
  for (const u of unsubs) u()
  for (const u of objectUrls) URL.revokeObjectURL(u)
  objectUrls.clear()
})

// --- view mode --------------------------------------------------------------
const lb = ref<InstanceType<typeof ZenLightbox> | null>(null)
const ddOpen = ref(false)
const INTERVALS = [1000, 2000, 3000, 5000, 10000]
const zoomPct = computed(() => Math.round((lb.value?.zoom ?? 1) * 100))
const playing = computed(() => lb.value?.playing ?? false)

function timeOf(ts: number) {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
function dims(it: HItem) {
  return it.width ? `${it.width} × ${it.height}` : ''
}
const current = computed<HItem | null>(
  () => history.value.find((i) => i.n === selectedN.value) ?? history.value[0] ?? null,
)
const lbItems = computed<LightboxItem[]>(() =>
  history.value.map((it) => ({
    src: it.url,
    kind: it.kind || 'image',
    label: it.channel || 'image',
    meta: [dims(it), timeOf(it.ts)].filter(Boolean).join('  ·  '),
  })),
)
const lbIndex = computed(() => {
  const c = current.value
  const i = c ? history.value.findIndex((h) => h.n === c.n) : 0
  return i < 0 ? 0 : i
})
function onIndex(i: number) {
  const it = history.value[i]
  if (it) selectedN.value = it.n
}
function setInterval(ms: number) {
  slideMs.value = ms
  ddOpen.value = false
}
function pick(it: HItem) {
  selectedN.value = it.n
}

/* --- full panel -------------------------------------------------------------
 * Chrome off, media only. Navigation moves to two click zones at the left and right EDGES of
 * the stage rather than whole halves: the middle has to stay free for the lightbox's own
 * pan-drag and wheel-zoom, and for a video's native controls. */

/** Zone width: a generous edge, but never so wide it eats the middle on a narrow panel. */
const NAV_ZONE = 'clamp(64px, 22%, 160px)'
/** The lightbox's video/audio control bar owns a strip along the bottom; keep the zones clear of it. */
const VIDEO_CONTROLS_H = 56

const canPrev = computed(() => lbIndex.value > 0)
const canNext = computed(() => lbIndex.value < history.value.length - 1)
const navBottom = computed(() =>
  current.value?.kind === 'video' || current.value?.kind === 'audio' ? VIDEO_CONTROLS_H : 0,
)
const showNav = computed(() => full.value && mode.value === 'view' && history.value.length > 1)

function toggleFull() {
  full.value = !full.value
}

// Entering and leaving full panel: the bars fold away (or back) rather than vanishing, so the
// stage visibly grows into the space — the lightbox refits the media as it does.
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
// Height, padding and borders all go to zero together: a padded bar squeezed by height alone
// stops at its padding and then vanishes — a visible second step at the end.
const BOX = [
  'height',
  'paddingTop',
  'paddingBottom',
  'borderTopWidth',
  'borderBottomWidth',
] as const
function animateBar(el: Element, done: () => void, entering: boolean) {
  const bar = el as HTMLElement
  if (reducedMotion()) return done()
  const cs = getComputedStyle(bar)
  const open = { height: `${bar.offsetHeight}px`, opacity: '1' } as Record<string, string>
  const shut = { height: '0px', opacity: '0' } as Record<string, string>
  for (const key of BOX.slice(1)) {
    open[key] = cs[key]
    shut[key] = '0px'
  }
  Object.assign(bar.style, {
    overflow: 'hidden',
    boxSizing: 'border-box',
    ...(entering ? shut : open),
  })
  void bar.offsetHeight
  bar.style.transition = 'all 0.24s cubic-bezier(0.22, 0.8, 0.2, 1)'
  Object.assign(bar.style, entering ? open : shut)
  const finish = (e: TransitionEvent) => {
    if (e.target !== bar || e.propertyName !== 'height') return
    bar.removeEventListener('transitionend', finish)
    for (const key of [...BOX, 'overflow', 'boxSizing', 'opacity', 'transition'] as const)
      bar.style[key] = ''
    done()
  }
  bar.addEventListener('transitionend', finish)
}
const barEnter = (el: Element, done: () => void) => animateBar(el, done, true)
const barLeave = (el: Element, done: () => void) => animateBar(el, done, false)

// Esc leaves full panel — the header button that got you in is hidden by then. Ignored while
// typing, so it can't fire from a field in some other panel.
function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape' || !full.value) return
  const t = e.target
  if (
    t instanceof HTMLElement &&
    (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
  )
    return
  full.value = false
  e.preventDefault()
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
function removeItem(it: HItem, ev?: Event) {
  ev?.stopPropagation()
  const idx = history.value.findIndex((i) => i.n === it.n)
  if (idx === -1) return
  const next = history.value.filter((i) => i.n !== it.n)
  forget(it)
  history.value = next
  if (selectedN.value === it.n) selectedN.value = (next[idx] ?? next[idx - 1] ?? next[0])?.n ?? null
}
function clearHistory() {
  for (const it of history.value) forget(it)
  history.value = []
  selectedN.value = null
}

// What other plugins (and the agent) can read and do with this viewer while it is mounted.
type SentItem = {
  url?: unknown
  ref?: unknown
  label?: unknown
  filename?: unknown
  kind?: unknown
}
const asChannelImage = (it: SentItem): ChannelImage | null =>
  typeof it.url === 'string'
    ? {
        channel: 'sent',
        url: it.url,
        ref: typeof it.ref === 'string' ? it.ref : undefined,
        filename: typeof it.filename === 'string' ? it.filename : undefined,
        label: typeof it.label === 'string' ? it.label : undefined,
        kind: it.kind === 'video' || it.kind === 'audio' ? it.kind : 'image',
        ts: Date.now(),
      }
    : null
const indexList = (v: unknown) =>
  Array.isArray(v) ? v.filter((i): i is number => typeof i === 'number') : []
onBeforeUnmount(
  props.ctx?.expose({
    describe: () => ({
      mode: mode.value,
      following:
        feedOf() === null
          ? 'nothing (only items sent here)'
          : feedOf() === '$last'
            ? 'most recent on any channel'
            : feedOf(),
      selected: Math.max(
        0,
        history.value.findIndex((it) => it.n === selectedN.value),
      ),
      items: history.value.map((it, index) => ({
        index,
        label: it.label ?? it.filename ?? it.channel,
        kind: it.kind ?? 'image',
        ref: it.ref ?? it.url,
        from: it.dropped ? 'sent' : it.channel,
      })),
    }),
    commands: {
      show: {
        description:
          'Add media: {items: [{url, ref?, label?, kind?}], replace?: boolean (clear first), follow?: boolean (keep following a channel; default false)}',
        run: ({ items, replace, follow }) => {
          const media = (Array.isArray(items) ? (items as SentItem[]) : [])
            .map(asChannelImage)
            .filter((it) => it !== null)
          if (!media.length) throw new Error('No items with a url to show.')
          mode.value = 'view'
          if (follow !== true) chan.value = NO_FEED
          if (replace === true) clearHistory()
          pushAll(media, true)
          return { shown: media.length, total: history.value.length }
        },
      },
      remove: {
        description: 'Remove items by index: {indices: number[]}',
        run: ({ indices }) => {
          const gone = new Set(indexList(indices))
          for (const it of history.value.filter((_, i) => gone.has(i))) removeItem(it)
          return { total: history.value.length }
        },
      },
      select: {
        description: 'Show the item at {index}',
        run: ({ index }) => {
          const it = typeof index === 'number' ? history.value[index] : undefined
          if (!it) throw new Error(`No item at index ${String(index)}.`)
          selectedN.value = it.n
          return { selected: index }
        },
      },
      clear: { description: 'Remove every item', run: () => clearHistory() },
      follow: {
        description: 'Follow a channel: {channel: "<name>" | "" for most recent | null for none}',
        run: ({ channel }) => {
          chan.value = channel === null ? NO_FEED : String(channel ?? '')
          return { following: feedOf() }
        },
      },
    },
  }) ?? (() => {}),
)

/* --- drop-to-add ------------------------------------------------------------
 * Drop an image/video/audio anywhere on the panel and it joins this viewer's history:
 * a tile from the Zen Asset Browser, a card from ComfyUI's own asset browser, any image
 * on a web page, or a file off the desktop. */

const dragOver = ref(false)
const loadingDrop = ref(false)
// Object urls minted for dropped local files. They pin their blob until revoked, so the panel
// owns every one it creates and releases it on removal, trim-off, or unmount.
const objectUrls = new Set<string>()

function forget(it: Pick<HItem, 'url'>) {
  if (it.url && objectUrls.delete(it.url)) URL.revokeObjectURL(it.url)
}

// Dragging an item out (into a node, the agent's chat, another viewer). While one of this
// viewer's own items is in flight, it doesn't take the drop back.
let draggingOwn = false
function onThumbDrag(e: DragEvent, it: HItem) {
  draggingOwn = true
  setImageDragData(
    e,
    { url: it.url, filename: it.filename, ref: it.ref },
    (e.currentTarget as HTMLElement).querySelector('img'),
  )
}

function onDragOver(e: DragEvent) {
  if (draggingOwn || !hasImageDragData(e)) return
  e.preventDefault() // required, or the browser never fires `drop` here
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  dragOver.value = true
}
function onDragLeave(e: DragEvent) {
  // dragleave also fires crossing between children; only drop the highlight on a real exit.
  const to = e.relatedTarget as Node | null
  if (to && (e.currentTarget as HTMLElement).contains(to)) return
  dragOver.value = false
}
async function onDrop(e: DragEvent) {
  dragOver.value = false
  const isList = e.dataTransfer?.types.includes(ZEN_MEDIA_LIST_MIME) ?? false
  if (!isList && !readImageDragData(e).length) return // nothing we understand — let ComfyUI have it
  // Claiming the event is what stops the graph ALSO importing the file: ComfyUI's
  // document-level drop handler returns early on `defaultPrevented`.
  e.preventDefault()
  e.stopPropagation()
  mode.value = 'view' // compare mode has no history strip; show what they just dropped
  const dropped = readMediaListDrop(e) // reads the drop now; a gallery's items are fetched after
  loadingDrop.value = isList
  const { items } = await dropped
  loadingDrop.value = false
  for (const it of items) if (it.objectUrl) objectUrls.add(it.url)
  pushAll(
    items.map((it) => ({
      channel: it.filename || 'dropped',
      url: it.url,
      filename: it.filename,
      kind: it.kind,
      ts: Date.now(),
    })),
    true,
  )
}

// --- compare mode -----------------------------------------------------------
const pos = ref(50)
const dragging = ref(false) // hide the handle while actively sliding
const stage = ref<HTMLElement | null>(null)
const stageW = ref(0)
function resolve(name: string): ChannelImage | null {
  const n = (name || '').trim()
  return !n ? last.value : (byName.value[n] ?? null)
}
const itemA = computed(() => resolve(chanA.value))
const itemB = computed(() => resolve(chanB.value))
// Two videos compared play as one: A leads (B when only B is a video), with the shared control bar
// driving it, and the other follows its clock — muted, so there is one soundtrack.
const vidA = ref<HTMLVideoElement | null>(null)
const vidB = ref<HTMLVideoElement | null>(null)
const asVideo = (el: unknown) => (el instanceof HTMLVideoElement ? el : null)
const setVidA = (el: unknown) => (vidA.value = asVideo(el))
const setVidB = (el: unknown) => (vidB.value = asVideo(el))
const leader = computed(() => vidA.value ?? vidB.value)
const follower = computed(() => (vidA.value && vidB.value ? vidB.value : null))
const FOLLOW_EVENTS = ['play', 'pause', 'seeked', 'seeking', 'ratechange', 'timeupdate'] as const
function follow() {
  const [lead, f] = [leader.value, follower.value]
  if (!lead || !f) return
  if (f.playbackRate !== lead.playbackRate) f.playbackRate = lead.playbackRate
  if (Math.abs(f.currentTime - lead.currentTime) > 0.06) f.currentTime = lead.currentTime
  if (lead.paused !== f.paused) void (lead.paused ? f.pause() : f.play().catch(() => {}))
}
watch(leader, (lead, old) => {
  for (const ev of FOLLOW_EVENTS) old?.removeEventListener(ev, follow)
  for (const ev of FOLLOW_EVENTS) lead?.addEventListener(ev, follow)
})
watch(follower, () => follow())
onBeforeUnmount(() => {
  for (const ev of FOLLOW_EVENTS) leader.value?.removeEventListener(ev, follow)
})

const urlA = computed(() => itemA.value?.url || '')
const urlB = computed(() => itemB.value?.url || '')
const kindA = computed(() => itemA.value?.kind || 'image')
const kindB = computed(() => itemB.value?.kind || 'image')
function swap() {
  const t = chanA.value
  chanA.value = chanB.value
  chanB.value = t
}

let ro: ResizeObserver | null = null
function measure() {
  if (stage.value) stageW.value = stage.value.clientWidth
}
watch([mode, stage], () => {
  measure()
  if (mode.value === 'compare' && stage.value && typeof ResizeObserver !== 'undefined') {
    ro?.disconnect()
    ro = new ResizeObserver(measure)
    ro.observe(stage.value)
  }
})
onBeforeUnmount(() => ro?.disconnect())
function startDrag(e: PointerEvent) {
  const el = stage.value
  if (!el) return
  dragging.value = true
  const move = (m: PointerEvent) => {
    const r = el.getBoundingClientRect()
    pos.value = Math.max(0, Math.min(100, ((m.clientX - r.left) / r.width) * 100))
  }
  move(e)
  const up = () => {
    dragging.value = false
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}
</script>

<template>
  <div class="mv" @dragover="onDragOver" @dragleave="onDragLeave" @drop="onDrop">
    <!-- header: mode toggle + per-mode controls (hidden in full panel) -->
    <Transition :css="false" @enter="barEnter" @leave="barLeave">
      <div v-if="!full" class="mv-head">
        <ZenToggleGroup
          :model-value="mode"
          :options="MODE_OPTIONS"
          @update:model-value="(v) => (mode = v as Mode)"
        />
        <span class="mv-sep" />

        <!-- view-mode controls -->
        <template v-if="mode === 'view'">
          <label class="pick">
            <i class="mdi mdi-pound" />
            <ZenSelect
              :model-value="chan"
              :options="chanOptions"
              placeholder="✦ Most recent"
              @update:model-value="(v) => (chan = String(v))"
            />
          </label>
          <span class="grow" />
          <button
            v-if="history.length"
            class="tb"
            :class="{ on: showThumbs }"
            title="Toggle thumbnails"
            @click="showThumbs = !showThumbs"
          >
            <i class="mdi mdi-view-gallery-outline" />
          </button>
          <button class="tb" title="Full panel — hide all chrome (Esc to exit)" @click="toggleFull">
            <i class="mdi mdi-fullscreen" />
          </button>
          <button
            v-if="history.length"
            class="tb danger"
            title="Clear history"
            @click="clearHistory"
          >
            <i class="mdi mdi-delete-sweep-outline" />
          </button>
        </template>

        <!-- compare-mode controls -->
        <template v-else>
          <label class="pick">
            <ZenSelect
              :model-value="chanA"
              :options="chanOptions"
              placeholder="✦ Most recent"
              @update:model-value="(v) => (chanA = String(v))"
            />
          </label>
          <button class="tb cmp-swap" title="Swap the two channels" @click="swap">
            <i class="mdi mdi-swap-horizontal" />
          </button>
          <label class="pick">
            <ZenSelect
              :model-value="chanB"
              :options="chanOptions"
              placeholder="✦ Most recent"
              @update:model-value="(v) => (chanB = String(v))"
            />
          </label>
          <span class="grow" />
          <span class="seen">
            {{ names.length ? names.length + ' channel(s)' : 'no channels yet' }}
          </span>
        </template>
      </div>
    </Transition>

    <!-- stage -->
    <div class="mv-stage" :class="{ 'is-full': full }">
      <!-- full panel: edge click-zones for prev/next. Only the edges take pointer events, so
           the middle keeps the lightbox's pan-drag, wheel-zoom and any native video controls. -->
      <template v-if="showNav">
        <button
          class="mv-nav prev"
          :disabled="!canPrev"
          title="Previous"
          :style="{ width: NAV_ZONE, bottom: navBottom + 'px' }"
          @click="lb?.prev()"
        >
          <i class="mdi mdi-chevron-left" />
        </button>
        <button
          class="mv-nav next"
          :disabled="!canNext"
          title="Next"
          :style="{ width: NAV_ZONE, bottom: navBottom + 'px' }"
          @click="lb?.next()"
        >
          <i class="mdi mdi-chevron-right" />
        </button>
      </template>
      <!-- the only way back out, since the header is gone. Fades in on hover. -->
      <button v-if="full" class="mv-unfull" title="Exit full panel (Esc)" @click="toggleFull">
        <i class="mdi mdi-fullscreen-exit" />
      </button>
      <template v-if="mode === 'view'">
        <ZenLightbox
          v-if="history.length"
          ref="lb"
          inline
          controls="none"
          :items="lbItems"
          :index="lbIndex"
          :slideshow-ms="slideMs"
          :slideshow-to-end="slideToEnd"
          @update:index="onIndex"
        />
        <div v-else class="mv-empty">
          <i class="mdi mdi-image-sync-outline mv-empty-icon" />
          <p class="mv-empty-title">Waiting for an image…</p>
          <p class="mv-empty-sub">
            Run a
            <b>Zen Sync Image</b>
            node on a channel, then watch it here (blank = most recent on any channel).
          </p>
        </div>
      </template>

      <div v-else ref="stage" class="cmp-stage" @pointerdown="startDrag">
        <template v-if="urlB">
          <video
            v-if="kindB === 'video'"
            :ref="setVidB"
            :src="urlB"
            class="layer"
            muted
            loop
            playsinline
          />
          <img v-else :src="urlB" class="layer" draggable="false" alt="" />
        </template>
        <div class="clipA" :style="{ width: pos + '%' }">
          <template v-if="urlA">
            <video
              v-if="kindA === 'video'"
              :ref="setVidA"
              :src="urlA"
              class="layer"
              :style="{ width: stageW + 'px' }"
              loop
              playsinline
            />
            <img
              v-else
              :src="urlA"
              class="layer"
              :style="{ width: stageW + 'px' }"
              draggable="false"
              alt=""
            />
          </template>
        </div>
        <div v-show="dragging && (urlA || urlB)" class="divider" :style="{ left: pos + '%' }"></div>
        <ZenMediaControls v-if="leader" class="cmp-mc" :media="leader" :compact="stageW < 420" />
        <div v-if="urlA || urlB" class="cmp-notch" :style="{ left: pos + '%' }">
          <span class="nt top" />
          <span class="nt bottom" />
        </div>
        <div v-if="!urlA && !urlB" class="mv-empty">
          <i class="mdi mdi-compare mv-empty-icon" />
          <p class="mv-empty-title">
            {{ names.length ? 'Pick a channel per side' : 'No images published yet' }}
          </p>
          <p class="mv-empty-sub">
            Type a channel name into A and B (blank = most recent). Drive each side with a separate
            Zen Sync Image node.
          </p>
        </div>
      </div>
    </div>

    <!-- slim bottom bar: view manipulation, only while viewing an image -->
    <Transition :css="false" @enter="barEnter" @leave="barLeave">
      <div v-if="mode === 'view' && history.length && !full" class="mv-foot">
        <button class="tb" title="Previous" :disabled="lbIndex <= 0" @click="lb?.prev()">
          <i class="mdi mdi-chevron-left" />
        </button>
        <button
          class="tb"
          title="Next"
          :disabled="lbIndex >= history.length - 1"
          @click="lb?.next()"
        >
          <i class="mdi mdi-chevron-right" />
        </button>
        <span class="mv-sep" />
        <button class="tb" title="Zoom out" @click="lb?.zoomOut()">
          <i class="mdi mdi-magnify-minus-outline" />
        </button>
        <span class="mv-z">{{ zoomPct }}%</span>
        <button class="tb" title="Zoom in" @click="lb?.zoomIn()">
          <i class="mdi mdi-magnify-plus-outline" />
        </button>
        <button class="tb" title="Fit / reset" @click="lb?.reset()">
          <i class="mdi mdi-fit-to-screen-outline" />
        </button>
        <span class="mv-sep" />
        <button class="tb" title="Rotate left" @click="lb?.rotate(-90)">
          <i class="mdi mdi-rotate-left" />
        </button>
        <button class="tb" title="Rotate right" @click="lb?.rotate(90)">
          <i class="mdi mdi-rotate-right" />
        </button>
        <span class="mv-sep" />
        <div class="mv-dd up">
          <button class="tb" :class="{ on: playing }" title="Slideshow" @click="lb?.togglePlay()">
            <i class="mdi" :class="playing ? 'mdi-pause' : 'mdi-play'" />
          </button>
          <button class="tb caret" title="Slideshow settings" @click="ddOpen = !ddOpen">
            <i class="mdi mdi-menu-up" />
          </button>
          <div v-if="ddOpen" class="mv-dd-menu up">
            <div class="mv-dd-h">Time per picture</div>
            <button
              v-for="ms in INTERVALS"
              :key="ms"
              :class="{ on: slideMs === ms }"
              @click="setInterval(ms)"
            >
              {{ ms / 1000 }}s
            </button>
            <div class="mv-dd-sep" />
            <button
              class="mv-dd-check"
              title="Off: videos and audio get the same time as pictures"
              @click="slideToEnd = !slideToEnd"
            >
              <i class="mdi" :class="slideToEnd ? 'mdi-checkbox-marked' : 'mdi-checkbox-blank-outline'" />
              Play videos to the end
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- view-mode thumbnail strip -->
    <Transition :css="false" @enter="barEnter" @leave="barLeave">
      <div v-if="mode === 'view' && history.length && showThumbs && !full" class="mv-strip">
        <div
          v-for="it in history"
          :key="it.n"
          class="mv-thumb"
          draggable="true"
          :class="{ active: current && it.n === current.n }"
          @dragstart="onThumbDrag($event, it)"
          @dragend="draggingOwn = false"
          :title="(it.channel ? it.channel + ' — ' : '') + timeOf(it.ts)"
          @click="pick(it)"
        >
          <video
            v-if="it.kind === 'video'"
            :src="it.url + '#t=0.1'"
            muted
            preload="metadata"
            playsinline
          ></video>
          <i v-else-if="it.kind === 'audio'" class="mdi mdi-music-note mv-thumb-ic"></i>
          <img v-else :src="it.url" alt="" />
          <i v-if="it.kind === 'video'" class="mdi mdi-play-circle mv-thumb-badge"></i>
          <button class="mv-thumb-x" title="Remove" @click="removeItem(it, $event)">
            <i class="mdi mdi-close" />
          </button>
        </div>
      </div>
    </Transition>

    <div v-if="ddOpen" class="mv-dd-backdrop" @click="ddOpen = false" />

    <!-- drop affordance: pointer-events:none so it never swallows the drop it advertises -->
    <div v-if="loadingDrop" class="mv-drop">
      <i class="mdi mdi-loading mdi-spin mv-drop-icon" />
      <p class="mv-drop-title">Loading the collection…</p>
    </div>
    <div v-else-if="dragOver" class="mv-drop">
      <i class="mdi mdi-image-plus mv-drop-icon" />
      <p class="mv-drop-title">Drop to add to this viewer</p>
      <p class="mv-drop-sub">
        image, video or audio — from the Asset Browser, a page, or your desktop
      </p>
    </div>
  </div>
</template>

<style scoped>
.mv {
  position: relative; /* containing block for .mv-drop */
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  background: var(--zen-bg, #1a1a1f);
  color: var(--zen-text, #e5e5ea);
  font-family: var(--p-font-family, system-ui, sans-serif);
}

/* header */
.mv-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 5px 8px;
  font-size: 12px;
  border-bottom: 1px solid var(--zen-border, rgba(255, 255, 255, 0.08));
  flex-wrap: wrap;
}
.grow {
  flex: 1;
}
.mv-sep {
  width: 1px;
  align-self: stretch;
  margin: 3px 4px;
  background: var(--zen-border, rgba(255, 255, 255, 0.1));
}

.pick {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--zen-muted, #9aa0aa);
}
.pick .lbl {
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 700;
}
.pick .mdi {
  font-size: 14px;
  opacity: 0.7;
}
.pick :deep(.zen-select) {
  min-width: 120px;
}
.pick :deep(.zs-trigger) {
  width: 100%;
}
.cin {
  font-size: 12px;
  font-family: inherit;
  padding: 4px 8px;
  border-radius: var(--zen-radius, 6px);
  width: 120px;
  background: var(--zen-surface, #202026);
  color: var(--zen-text, #e5e5ea);
  border: 1px solid var(--zen-border, #3a3a44);
}
.cin:focus {
  outline: none;
  border-color: var(--zen-accent, #3b82f6);
}
.seen {
  font-size: 11px;
  color: var(--zen-muted, #9aa0aa);
  white-space: nowrap;
}

.tb {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: var(--zen-radius, 5px);
  background: transparent;
  color: var(--zen-text, #e5e5ea);
  cursor: pointer;
}
.tb:hover {
  background: color-mix(in srgb, var(--zen-text, #fff) 12%, transparent);
}
.tb:disabled {
  opacity: 0.3;
  cursor: default;
}
.tb.on {
  background: var(--zen-accent, #3b82f6);
  color: var(--zen-accent-text, #fff);
}
.tb.danger:hover {
  background: #b91c1c;
  color: #fff;
}
.tb .mdi {
  font-size: 16px;
}
/* stretch to the row height so it always matches the (content-height) channel pickers */
.cmp-swap {
  width: 30px;
  height: auto;
  align-self: stretch;
  background: color-mix(in srgb, var(--zen-accent, #3b82f6) 16%, transparent);
  border: 1px solid var(--zen-border, #2a2c34);
  color: var(--zen-accent, #3b82f6);
}
.cmp-swap:hover {
  background: var(--zen-accent, #3b82f6);
  color: var(--zen-accent-text, #fff);
}
.tb.caret {
  width: 16px;
}
.mv-z {
  font-size: 11px;
  color: var(--zen-muted, #9aa0aa);
  min-width: 38px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.mv-dd {
  position: relative;
  display: inline-flex;
}
.mv-dd-menu {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 20;
  margin-top: 4px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 120px;
  background: var(--zen-chrome-bg, var(--zen-surface, #26262c));
  border: 1px solid var(--zen-border, rgba(255, 255, 255, 0.14));
  border-radius: var(--zen-radius, 8px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}
.mv-dd-h {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--zen-muted, #9aa0aa);
  padding: 2px 4px 4px;
}
.mv-dd-menu button {
  text-align: left;
  padding: 5px 8px;
  font-size: 12px;
  border: none;
  border-radius: var(--zen-radius, 5px);
  background: transparent;
  color: var(--zen-text, #e5e5ea);
  cursor: pointer;
}
.mv-dd-menu button:hover {
  background: color-mix(in srgb, var(--zen-text, #fff) 10%, transparent);
}
.mv-dd-menu button.on {
  background: var(--zen-accent, #3b82f6);
  color: var(--zen-accent-text, #fff);
}
.mv-dd-sep {
  height: 1px;
  margin: 3px 0;
  background: var(--zen-border, rgba(255, 255, 255, 0.14));
}
.mv-dd-menu .mv-dd-check {
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.mv-dd-check .mdi {
  color: var(--zen-accent, #3b82f6);
  font-size: 15px;
}
.mv-dd-backdrop {
  position: fixed;
  inset: 0;
  z-index: 15;
}
/* slideshow menu flipped to open upward (the dropdown now lives in the bottom bar) */
.mv-dd-menu.up {
  top: auto;
  bottom: 100%;
  margin-top: 0;
  margin-bottom: 4px;
}

/* slim bottom control bar: nav + zoom + rotate + slideshow, centered */
.mv-foot {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 5px 8px;
  border-top: 1px solid var(--zen-border, rgba(255, 255, 255, 0.08));
  background: var(--zen-chrome-bg, var(--zen-surface-2, rgba(0, 0, 0, 0.18)));
}

/* stage (positioned so the inline ZenLightbox / compare layers fill it) */
.mv-stage {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
}

.mv-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  text-align: center;
  padding: 24px;
  opacity: 0.85;
  color: var(--zen-muted, #9aa0aa);
}
.mv-empty-icon {
  font-size: 46px;
  opacity: 0.5;
  margin-bottom: 4px;
}
.mv-empty-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--zen-text);
}
.mv-empty-sub {
  margin: 0;
  font-size: 12.5px;
  opacity: 0.75;
  max-width: 300px;
}

/* compare stage */
.cmp-stage {
  position: absolute;
  inset: 0;
  overflow: hidden;
  touch-action: none;
  user-select: none;
  cursor: ew-resize;
  background: repeating-conic-gradient(#1c1c22 0% 25%, #16161b 0% 50%) 50% / 22px 22px;
}
.layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.clipA {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  overflow: hidden;
}
.clipA .layer {
  max-width: none;
}
.divider {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--zen-accent, #3b82f6);
  transform: translateX(-1px);
  pointer-events: none;
}
/* always-visible split hint: triangles at top + bottom pointing inward */
.cmp-mc {
  position: absolute;
  right: 12px;
  bottom: 10px;
  left: 12px;
  z-index: 4;
  max-width: 760px;
  margin: 0 auto;
  cursor: default;
}
.cmp-notch {
  position: absolute;
  top: 0;
  bottom: 0;
  pointer-events: none;
  z-index: 2;
}
.cmp-notch .nt {
  position: absolute;
  left: 0;
  transform: translateX(-50%);
  width: 0;
  height: 0;
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  filter: drop-shadow(0 0 2px rgba(0, 0, 0, 0.55));
}
.cmp-notch .nt.top {
  top: 0;
  border-top: 9px solid var(--zen-accent, #3b82f6);
}
.cmp-notch .nt.bottom {
  bottom: 0;
  border-bottom: 9px solid var(--zen-accent, #3b82f6);
}

/* thumbnail strip */
.mv-strip {
  flex: 0 0 auto;
  display: flex;
  gap: 6px;
  padding: 8px;
  overflow-x: auto;
  border-top: 1px solid var(--zen-border, rgba(255, 255, 255, 0.08));
  background: var(--zen-chrome-bg, var(--zen-surface-2, rgba(0, 0, 0, 0.2)));
}
.mv-thumb {
  position: relative;
  flex: 0 0 auto;
  width: 52px;
  height: 52px;
  border: 2px solid transparent;
  border-radius: var(--zen-radius, 5px);
  overflow: hidden;
  cursor: pointer;
  background: var(--zen-input, #15151a);
  transition: border-color 0.12s ease;
}
.mv-thumb img,
.mv-thumb video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.mv-thumb-ic {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  font-size: 22px;
  color: var(--zen-muted, #9aa0aa);
}
.mv-thumb-badge {
  position: absolute;
  top: 1px;
  left: 2px;
  font-size: 12px;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85);
  pointer-events: none;
}
.mv-thumb:hover {
  border-color: var(--zen-muted, rgba(255, 255, 255, 0.3));
}
.mv-thumb.active {
  border-color: var(--zen-accent, #7aa2ff);
}
.mv-thumb-x {
  position: absolute;
  top: 1px;
  right: 1px;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  font-size: 13px;
  line-height: 1;
  color: #fff;
  background: rgba(0, 0, 0, 0.6);
  border: none;
  border-radius: max(3px, calc(var(--zen-radius, 4px) - 1px));
  cursor: pointer;
  opacity: 0;
  transition:
    opacity 0.1s ease,
    background 0.1s ease;
}
.mv-thumb:hover .mv-thumb-x {
  opacity: 1;
}
.mv-thumb-x:hover {
  background: #b91c1c;
}

.mv-drop {
  position: absolute;
  inset: 0;
  z-index: 20;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  text-align: center;
  padding: 16px;
  background: color-mix(in srgb, var(--zen-accent, #6366f1) 16%, transparent);
  backdrop-filter: blur(2px);
  border: 2px dashed var(--zen-accent, #6366f1);
  border-radius: var(--zen-radius, 8px);
}
.mv-drop-icon {
  font-size: 32px;
  color: var(--zen-accent, #6366f1);
}
.mv-drop-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--zen-text, #e5e5ea);
}
.mv-drop-sub {
  margin: 0;
  font-size: 11px;
  opacity: 0.75;
  color: var(--zen-text, #e5e5ea);
}

/* --- full panel ------------------------------------------------------------- */
/* Edge zones sit above the lightbox but only span the edges, so the middle of the stage still
   belongs to pan/zoom. `bottom` is inset past a video's native control strip (see navBottom). */
.mv-nav {
  position: absolute;
  top: 0;
  z-index: 6;
  display: flex;
  align-items: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--zen-text, #e5e5ea);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease;
}
/* The zone stays a wide invisible hit area; only the chevron chip is ever drawn, so hovering
   the media doesn't wash its edges. Chip rather than a bare glyph so it reads on a light
   image, and it matches the exit button already sitting in the corner. */
.mv-nav.prev {
  left: 0;
  justify-content: flex-start;
}
.mv-nav.next {
  right: 0;
  justify-content: flex-end;
}
.mv-nav i {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  margin: 0 8px;
  font-size: 22px;
  border: 1px solid var(--zen-border, #3a3a44);
  border-radius: 999px;
  background: color-mix(in srgb, var(--zen-bg, #1a1a1f) 70%, transparent);
  backdrop-filter: blur(6px);
}
.mv-stage.is-full:hover .mv-nav:not(:disabled) {
  opacity: 0.9;
}
/* A disabled button still wins hit-testing and swallows the press without acting on it, which
   would leave a dead 160px band at the end of the list. With nothing to navigate to, hand the
   edge back to the lightbox so pan and zoom keep working there. */
.mv-nav:disabled {
  cursor: default;
  opacity: 0;
  pointer-events: none;
}
.mv-unfull {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 7;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--zen-border, #3a3a44);
  border-radius: var(--zen-radius, 6px);
  background: color-mix(in srgb, var(--zen-bg, #1a1a1f) 70%, transparent);
  backdrop-filter: blur(6px);
  color: var(--zen-text, #e5e5ea);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.mv-stage.is-full:hover .mv-unfull,
.mv-unfull:focus-visible {
  opacity: 1;
}
</style>
