<script setup lang="ts">
// ZenLightbox — image/video viewer: wheel-zoom, drag-pan, rotate, slideshow.
// `inline` fills its container; otherwise a fullscreen overlay.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, Teleport } from 'vue'
import ZenScroll from '../primitives/ZenScroll.vue'
import type { LightboxItem } from '../types'

const props = withDefaults(
  defineProps<{
    items: LightboxItem[]
    index: number
    inline?: boolean // true = fill container; false = fullscreen overlay
    slideshowMs?: number
    // Built-in chrome: 'bottom' (default), 'top', or 'none' (host drives it via
    // the exposed API — see defineExpose below). 'none' also hides the nav arrows.
    controls?: 'bottom' | 'top' | 'none'
  }>(),
  { inline: false, slideshowMs: 3000, controls: 'bottom' },
)
const emit = defineEmits<{ 'update:index': [number]; close: [] }>()
const showChrome = computed(() => props.controls !== 'none')

const item = computed<LightboxItem | undefined>(() => props.items[props.index])
const count = computed(() => props.items.length)

// A toggleable thumbnail panel — a lightweight "viewer" mode for paging a set.
// Remember the open/closed choice across opens (per browser, all lightboxes share it).
const STRIP_KEY = 'zenkit.lightbox.strip'
function loadStrip(): boolean {
  try {
    return localStorage.getItem(STRIP_KEY) === '1'
  } catch {
    return false
  }
}
const strip = ref(loadStrip())
watch(strip, (v) => {
  try {
    localStorage.setItem(STRIP_KEY, v ? '1' : '0')
  } catch {
    /* storage may be unavailable */
  }
})
// Click the dark stage around the image (not the image itself) to close — only when not
// zoomed in (so a pan-drag never closes it). The image is a child, so @click.self on the
// stage fires only for the backdrop.
function onStageClick() {
  if (!props.inline && zoom.value === 1) emit('close')
}

// --- virtualized thumbnail grid (search + zoom; only visible rows render) ----------------
// Each entry keeps its ORIGINAL index `i` so click → go(i) and highlight track props.index
// regardless of search filtering.
const search = ref('')
const T_GAP = 7
const T_OVERSCAN = 3
const tileW = ref(92) // min tile width; tiles grow to fill the row
const sideWidth = ref(264) // panel width — user-resizable via the drag handle
const sideScroll = ref<{ $el?: HTMLElement } | null>(null) // the ZenScroll component ref
const sideScrollTop = ref(0)
const sideW = ref(244)
const sideH = ref(480)
let sideRO: ResizeObserver | null = null
const scrollDiv = (): HTMLElement | null => (sideScroll.value?.$el as HTMLElement) ?? null

function onSideScroll(e: Event) {
  sideScrollTop.value = (e.target as HTMLElement).scrollTop
}
function measureSide() {
  const el = scrollDiv()
  if (el) {
    sideW.value = Math.max(40, el.clientWidth - 20) // minus 10px padding each side
    sideH.value = el.clientHeight
  }
}
function zoomThumbs(d: number) {
  tileW.value = Math.max(56, Math.min(220, tileW.value + d * 22))
}

// drag-resize the panel width
let resizing = false
let rStartX = 0
let rStartW = 0
function startResize(e: PointerEvent) {
  resizing = true
  rStartX = e.clientX
  rStartW = sideWidth.value
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  e.preventDefault()
}
function onResize(e: PointerEvent) {
  if (resizing) sideWidth.value = Math.max(190, Math.min(560, rStartW + (e.clientX - rStartX)))
}
function endResize(e: PointerEvent) {
  if (!resizing) return
  resizing = false
  try {
    ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
  } catch {
    /* not captured */
  }
}

const thumbs = computed(() => {
  const q = search.value.trim().toLowerCase()
  const out: { it: LightboxItem; i: number }[] = []
  props.items.forEach((it, i) => {
    if (!q || (it.label || '').toLowerCase().includes(q)) out.push({ it, i })
  })
  return out
})
const tCols = computed(() => Math.max(1, Math.floor((sideW.value + T_GAP) / (tileW.value + T_GAP))))
const tCellW = computed(() => (sideW.value - (tCols.value - 1) * T_GAP) / tCols.value)
const tRowH = computed(() => tCellW.value + T_GAP) // square tiles
const tTotalRows = computed(() => Math.ceil(thumbs.value.length / tCols.value))
const tTotalH = computed(() => Math.max(0, tTotalRows.value * tRowH.value - T_GAP))
const tStartRow = computed(() =>
  Math.max(0, Math.floor(sideScrollTop.value / tRowH.value) - T_OVERSCAN),
)
const tEndRow = computed(() =>
  Math.min(
    tTotalRows.value,
    Math.ceil((sideScrollTop.value + sideH.value) / tRowH.value) + T_OVERSCAN,
  ),
)
const tVisible = computed(() =>
  thumbs.value.slice(tStartRow.value * tCols.value, tEndRow.value * tCols.value),
)
const tGridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${tCols.value}, 1fr)`,
  gap: T_GAP + 'px',
  transform: `translateY(${tStartRow.value * tRowH.value}px)`,
}))

function scrollActiveIntoView() {
  const el = scrollDiv()
  if (!el) return
  const pos = thumbs.value.findIndex((t) => t.i === props.index)
  if (pos < 0) return
  const y = Math.floor(pos / tCols.value) * tRowH.value
  if (y < el.scrollTop) el.scrollTop = y
  else if (y + tRowH.value > el.scrollTop + el.clientHeight)
    el.scrollTop = y + tRowH.value - el.clientHeight + 10
}

// Attach a ResizeObserver once the panel mounts; reset scroll on a new search.
watch(sideScroll, () => {
  sideRO?.disconnect()
  sideRO = null
  const el = scrollDiv()
  if (el) {
    measureSide()
    if (typeof ResizeObserver !== 'undefined') {
      sideRO = new ResizeObserver(() => measureSide())
      sideRO.observe(el)
    }
    nextTick(scrollActiveIntoView)
  }
})
watch(search, () => {
  const el = scrollDiv()
  if (el) el.scrollTop = 0
  sideScrollTop.value = 0
})

// --- view transform ---------------------------------------------------------
const zoom = ref(1)
const rot = ref(0) // degrees
const tx = ref(0)
const ty = ref(0)
const MIN_Z = 1
const MAX_Z = 8

const imgStyle = computed(() => ({
  transform: `translate(${tx.value}px, ${ty.value}px) rotate(${rot.value}deg) scale(${zoom.value})`,
  cursor: zoom.value > 1 ? 'grab' : 'default',
}))

function reset() {
  zoom.value = 1
  rot.value = 0
  tx.value = 0
  ty.value = 0
}
function clampZoom(z: number) {
  return Math.max(MIN_Z, Math.min(MAX_Z, z))
}
function zoomBy(factor: number) {
  const z = clampZoom(zoom.value * factor)
  zoom.value = z
  if (z === 1) {
    tx.value = 0
    ty.value = 0
  }
}
function rotateBy(deg: number) {
  rot.value = (rot.value + deg) % 360
}
function download() {
  const it = item.value
  if (!it) return
  const a = document.createElement('a')
  a.href = it.src
  a.download = (it.label || 'image').split('/').pop() || 'image'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

function go(i: number) {
  if (i < 0 || i >= count.value) return
  emit('update:index', i)
}
const canPrev = computed(() => props.index > 0)
const canNext = computed(() => props.index < count.value - 1)

// reset transform whenever the shown image changes; keep the active thumb in view
watch(
  () => props.index,
  () => {
    reset()
    nextTick(scrollActiveIntoView)
  },
)

// --- pointer interactions ---------------------------------------------------
function onWheel(e: WheelEvent) {
  e.preventDefault()
  zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15)
}
function onDblClick() {
  reset()
}
function startPan(e: PointerEvent) {
  if (zoom.value <= 1) return
  e.preventDefault()
  const ox = e.clientX - tx.value
  const oy = e.clientY - ty.value
  const move = (m: PointerEvent) => {
    tx.value = m.clientX - ox
    ty.value = m.clientY - oy
  }
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

// --- slideshow --------------------------------------------------------------
const playing = ref(false)
let timer: ReturnType<typeof setInterval> | null = null
function tick() {
  if (!count.value) return
  go(props.index < count.value - 1 ? props.index + 1 : 0) // loop
}
function stopTimer() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
function togglePlay() {
  playing.value = !playing.value
}
function syncTimer() {
  stopTimer()
  if (playing.value) timer = setInterval(tick, Math.max(500, props.slideshowMs))
}
watch(playing, syncTimer)
// Restart the timer if the interval changes mid-playback (host dropdown).
watch(
  () => props.slideshowMs,
  () => playing.value && syncTimer(),
)

// --- keyboard ---------------------------------------------------------------
// Only the fullscreen overlay grabs keys (modal); inline would hijack arrows/space.
function isEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el || !el.tagName) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}
function onKey(e: KeyboardEvent) {
  if (isEditable(e.target)) return
  switch (e.key) {
    case 'Escape':
      if (!props.inline) emit('close')
      break
    case 'ArrowLeft':
      go(props.index - 1)
      break
    case 'ArrowRight':
      go(props.index + 1)
      break
    case '+':
    case '=':
      zoomBy(1.2)
      break
    case '-':
      zoomBy(1 / 1.2)
      break
    case '0':
      reset()
      break
    case 'r':
      rotateBy(90)
      break
    case 'R':
      rotateBy(-90)
      break
    case ' ':
      togglePlay()
      break
    default:
      return
  }
  e.preventDefault()
}
onMounted(() => {
  if (!props.inline) window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  stopTimer()
  sideRO?.disconnect()
})

// Imperative API for hosts that render their own chrome (controls="none").
// `zoom`/`rot`/`playing` are reactive refs — read them in the host's template.
defineExpose({
  zoom,
  rot,
  playing,
  zoomIn: () => zoomBy(1.2),
  zoomOut: () => zoomBy(1 / 1.2),
  reset,
  rotate: rotateBy,
  togglePlay,
  prev: () => go(props.index - 1),
  next: () => go(props.index + 1),
})
</script>

<template>
  <component :is="inline ? 'div' : Teleport" v-bind="inline ? {} : { to: 'body' }">
    <div
      class="zlb"
      :class="{ inline, 'has-side': showChrome && strip && count > 1 }"
      @pointerdown.self="!inline && emit('close')"
    >
      <!-- LEFT thumbnail panel: virtualized, searchable, zoomable, resizable square grid -->
      <aside
        v-if="showChrome && strip && count > 1"
        class="zlb-side"
        :style="{ flexBasis: sideWidth + 'px' }"
      >
        <div class="zlb-side-head">
          <button class="zlb-zb" title="Hide panel" @click.stop="strip = false">
            <i class="mdi mdi-chevron-left" />
          </button>
          <div class="zlb-search">
            <i class="mdi mdi-magnify" />
            <input v-model="search" placeholder="Search…" spellcheck="false" />
          </div>
        </div>
        <ZenScroll ref="sideScroll" class="zlb-tscroll" @scroll="onSideScroll">
          <div class="zlb-tpad" :style="{ height: tTotalH + 'px' }">
            <div class="zlb-grid" :style="tGridStyle">
              <button
                v-for="t in tVisible"
                :key="t.i"
                class="zlb-cell"
                :class="{ on: t.i === index }"
                :title="t.it.label"
                @click.stop="go(t.i)"
              >
                <!-- video poster = first frame via the #t media fragment (no server thumbnailing) -->
                <video
                  v-if="t.it.kind === 'video'"
                  :src="t.it.src + '#t=0.1'"
                  muted
                  preload="metadata"
                  playsinline
                />
                <i v-else-if="t.it.kind === 'audio'" class="mdi mdi-music-note zlb-cell-audio" />
                <img v-else :src="t.it.src" loading="lazy" alt="" />
                <i v-if="t.it.kind === 'video'" class="mdi mdi-play-circle zlb-cell-badge" />
                <i
                  v-if="t.it.onWorkflow"
                  class="mdi mdi-sitemap-outline zlb-cell-wf"
                  title="Has a workflow"
                />
              </button>
            </div>
          </div>
        </ZenScroll>
        <div class="zlb-side-foot">
          <button class="zlb-zb" title="Smaller (zoom out)" @click.stop="zoomThumbs(-1)">
            <i class="mdi mdi-magnify-minus-outline" />
          </button>
          <button class="zlb-zb" title="Larger (zoom in)" @click.stop="zoomThumbs(1)">
            <i class="mdi mdi-magnify-plus-outline" />
          </button>
          <span class="zlb-grow" />
          <span class="zlb-foot-n">
            {{ thumbs.length }}
            <template v-if="thumbs.length !== count">/ {{ count }}</template>
          </span>
        </div>
        <div
          class="zlb-resize"
          title="Drag to resize"
          @pointerdown="startResize"
          @pointermove="onResize"
          @pointerup="endResize"
        />
      </aside>

      <div class="zlb-main">
        <!-- top bar: title + position + close (kept off the image so nothing overlaps) -->
        <div v-if="showChrome" class="zlb-top">
          <button
            v-if="count > 1"
            class="zlb-tbtn"
            title="Thumbnails panel"
            :class="{ on: strip }"
            @click.stop="strip = !strip"
          >
            <i class="mdi mdi-view-grid-outline" />
          </button>
          <div class="zlb-info">
            <span v-if="item?.label" class="zlb-label">{{ item.label }}</span>
            <span class="zlb-pos">{{ count ? index + 1 : 0 }} / {{ count }}</span>
            <span v-if="item?.meta" class="zlb-meta">{{ item.meta }}</span>
          </div>
          <span class="zlb-grow" />
          <button
            v-if="item?.onWorkflow"
            class="zlb-tbtn"
            title="Load this image's workflow"
            @click.stop="item.onWorkflow?.()"
          >
            <i class="mdi mdi-sitemap-outline" />
          </button>
          <button v-if="!inline" class="zlb-tbtn" title="Close (Esc)" @click="emit('close')">
            <i class="mdi mdi-close" />
          </button>
        </div>

        <div
          class="zlb-stage"
          @wheel="onWheel"
          @pointerdown="startPan"
          @dblclick="onDblClick"
          @click.self="onStageClick"
        >
          <button
            v-if="showChrome"
            class="zlb-nav prev"
            :disabled="!canPrev"
            title="Previous (Left)"
            @click.stop="go(index - 1)"
          >
            <i class="mdi mdi-chevron-left" />
          </button>
          <video
            v-if="item && item.kind === 'video'"
            :src="item.src"
            class="zlb-media"
            controls
            autoplay
            loop
          />
          <div v-else-if="item && item.kind === 'audio'" class="zlb-audio">
            <i class="mdi mdi-music-circle-outline" />
            <span v-if="item.label" class="zlb-audio-name">{{ item.label }}</span>
            <audio :src="item.src" controls />
          </div>
          <img
            v-else-if="item"
            :key="index"
            :src="item.src"
            class="zlb-media"
            :style="imgStyle"
            draggable="false"
            alt=""
          />
          <div v-else class="zlb-empty"><i class="mdi mdi-image-off-outline" /></div>
          <button
            v-if="showChrome"
            class="zlb-nav next"
            :disabled="!canNext"
            title="Next (Right)"
            @click.stop="go(index + 1)"
          >
            <i class="mdi mdi-chevron-right" />
          </button>
        </div>

        <!-- bottom toolbar: view controls -->
        <div v-if="showChrome" class="zlb-bar">
          <button title="Slideshow (Space)" :class="{ on: playing }" @click.stop="togglePlay">
            <i class="mdi" :class="playing ? 'mdi-pause' : 'mdi-play'" />
          </button>
          <button title="Rotate left (Shift+R)" @click.stop="rotateBy(-90)">
            <i class="mdi mdi-rotate-left" />
          </button>
          <button title="Rotate right (R)" @click.stop="rotateBy(90)">
            <i class="mdi mdi-rotate-right" />
          </button>
          <span class="zlb-sep" />
          <button title="Zoom out (-)" @click.stop="zoomBy(1 / 1.2)">
            <i class="mdi mdi-magnify-minus-outline" />
          </button>
          <span class="zlb-zval">{{ Math.round(zoom * 100) }}%</span>
          <button title="Zoom in (+)" @click.stop="zoomBy(1.2)">
            <i class="mdi mdi-magnify-plus-outline" />
          </button>
          <button title="Reset (0 / double-click)" @click.stop="reset">
            <i class="mdi mdi-fit-to-screen-outline" />
          </button>
          <span class="zlb-sep" />
          <button title="Download" @click.stop="download"><i class="mdi mdi-download" /></button>
        </div>
      </div>
    </div>
  </component>
</template>

<style scoped>
.zlb {
  position: fixed;
  inset: 0;
  z-index: 100000;
  display: flex;
  flex-direction: row;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(4px);
  font-family: var(--p-font-family, system-ui, sans-serif);
  color: #e8e8ea;
}
.zlb.inline {
  position: absolute;
  z-index: 1;
  border-radius: var(--zen-radius, 8px);
  overflow: hidden;
  background: var(--zen-bg, #1a1a1f);
}

/* LEFT thumbnail panel — virtualized, searchable, zoomable (asset-gallery style) */
.zlb-side {
  position: relative;
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--zen-surface, #202026);
  border-right: 1px solid var(--zen-border, #34343c);
}
.zlb-resize {
  position: absolute;
  top: 0;
  right: -3px;
  bottom: 0;
  width: 8px;
  z-index: 4;
  cursor: ew-resize;
}
.zlb-resize:hover {
  background: color-mix(in srgb, var(--zen-accent, #3b82f6) 45%, transparent);
}
.zlb-side-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--zen-border, #34343c);
}
.zlb-search {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--zen-border, #34343c);
  border-radius: var(--zen-radius, 6px);
  background: var(--zen-input, #15151a);
}
.zlb-search:focus-within {
  border-color: var(--zen-accent, #3b82f6);
}
.zlb-search .mdi {
  font-size: 14px;
  color: var(--zen-muted, #9aa0aa);
}
.zlb-search input {
  flex: 1;
  min-width: 0;
  border: none;
  background: none;
  outline: none;
  color: var(--zen-text, #e5e5ea);
  font: inherit;
  font-size: 12px;
}
.zlb-zb {
  flex: none;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--zen-radius, 6px);
  background: transparent;
  color: var(--zen-muted, #9aa0aa);
  cursor: pointer;
}
.zlb-zb:hover {
  background: color-mix(in srgb, var(--zen-text, #fff) 10%, transparent);
  color: var(--zen-text, #fff);
}
.zlb-zb .mdi {
  font-size: 16px;
}
/* virtualization: ZenScroll container + full-height pad + windowed grid (overflow from ZenScroll) */
.zlb-tscroll {
  flex: 1;
  min-height: 0;
  padding: 10px;
}
.zlb-tpad {
  position: relative;
  width: 100%;
}
.zlb-grid {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: grid;
  align-content: start;
}
.zlb-cell {
  position: relative;
  aspect-ratio: 1;
  padding: 0;
  border: 1px solid var(--zen-border, #34343c);
  border-radius: var(--zen-radius, 8px);
  background: var(--zen-input, #15151a);
  cursor: pointer;
  overflow: hidden;
}
.zlb-cell img,
.zlb-cell video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.zlb-cell-audio {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  font-size: 30px;
  color: var(--zen-muted, #9aa0aa);
}
.zlb-cell-badge {
  position: absolute;
  top: 4px;
  left: 4px;
  font-size: 16px;
  color: #fff;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
  pointer-events: none;
}
.zlb-cell:hover {
  border-color: var(--zen-accent, #3b82f6);
}
.zlb-cell.on {
  border-color: var(--zen-accent, #3b82f6);
  box-shadow: 0 0 0 2px var(--zen-accent, #3b82f6) inset;
}
.zlb-cell-wf {
  position: absolute;
  bottom: 3px;
  right: 3px;
  font-size: 11px;
  color: #fff;
  background: rgba(0, 0, 0, 0.6);
  border-radius: 4px;
  padding: 1px 3px;
}
.zlb-side-foot {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 6px 8px;
  border-top: 1px solid var(--zen-border, #34343c);
}
.zlb-foot-n {
  font-size: 11px;
  color: var(--zen-muted, #9aa0aa);
  font-variant-numeric: tabular-nums;
  padding-right: 4px;
}

/* main column: top bar + stage + bottom toolbar (flex siblings → never overlap the image) */
.zlb-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.zlb-top {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
}
.zlb-grow {
  flex: 1;
}
.zlb-info {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}
.zlb-label {
  font-weight: 600;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 40vw;
}
.zlb-pos {
  font-size: 12px;
  color: #b8b8bd;
  font-variant-numeric: tabular-nums;
}
.zlb-meta {
  font-size: 11px;
  color: #9a9aa0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.zlb-tbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: var(--zen-radius, 8px);
  background: transparent;
  color: #d6d6da;
  cursor: pointer;
}
.zlb-tbtn:hover {
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
}
.zlb-tbtn.on {
  background: var(--zen-accent, #3b82f6);
  color: #fff;
}
.zlb-tbtn .mdi {
  font-size: 19px;
}

/* stage: image is centred with side gutters for the nav arrows, so nothing overlaps */
.zlb-stage {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  padding: 8px 64px;
}
/* inline embeds (MediaViewer/GalleryViewer) have no nav arrows → no side gutters */
.zlb.inline .zlb-stage {
  padding: 6px;
}
.zlb-media {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  display: block;
  border-radius: var(--zen-radius, 6px);
  transition: transform 0.05s linear;
}
.zlb-empty {
  opacity: 0.4;
  font-size: 48px;
}
/* audio: a big glyph + name + the native player, centred on the stage */
.zlb-audio {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  color: #e8e8ea;
  padding: 24px;
  max-width: 560px;
  width: 100%;
}
.zlb-audio .mdi {
  font-size: 96px;
  opacity: 0.5;
}
.zlb-audio-name {
  font-size: 14px;
  font-weight: 600;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.zlb-audio audio {
  width: 100%;
}
/* nav arrows: circular glassy pills; fully hidden (not ghosted) at the ends */
.zlb-nav {
  flex: none;
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 3;
  width: 46px;
  height: 46px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  background: rgba(18, 18, 22, 0.45);
  backdrop-filter: blur(6px);
  color: #fff;
  cursor: pointer;
  transition:
    background 0.12s ease,
    border-color 0.12s ease,
    transform 0.08s ease,
    opacity 0.12s ease;
}
.zlb-nav:hover:not(:disabled) {
  background: rgba(18, 18, 22, 0.72);
  border-color: color-mix(in srgb, var(--zen-accent, #3b82f6) 70%, transparent);
}
.zlb-nav:active:not(:disabled) {
  transform: translateY(-50%) scale(0.93);
}
.zlb-nav:disabled {
  opacity: 0;
  pointer-events: none;
}
.zlb-nav.prev {
  left: 14px;
}
.zlb-nav.next {
  right: 14px;
}
.zlb-nav .mdi {
  font-size: 26px;
}

/* bottom toolbar: centred view controls */
.zlb-bar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 8px 12px;
}
.zlb-bar button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: var(--zen-radius, 7px);
  background: transparent;
  color: #d6d6da;
  cursor: pointer;
}
.zlb-bar button:hover {
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
}
.zlb-bar button.on {
  background: var(--zen-accent, #3b82f6);
  color: #fff;
}
.zlb-bar .mdi {
  font-size: 18px;
}
.zlb-sep {
  width: 1px;
  height: 20px;
  margin: 0 6px;
  background: rgba(255, 255, 255, 0.14);
}
.zlb-zval {
  font-size: 11px;
  color: #b8b8bd;
  min-width: 40px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
</style>
