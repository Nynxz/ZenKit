<script setup lang="ts">
import '../lib/motion.css'
// ZenLightbox — image/video viewer: wheel-zoom, drag-pan, rotate, slideshow.
// `inline` fills its container (hosts like the Media Viewer draw their own chrome); otherwise an
// immersive fullscreen overlay over the theme's background: the picture edge to edge, with a
// thumbnails sidebar and a title line + toolbar that fade in on movement. The chrome is built from
// ZenKit's own buttons and surfaces so every theme dresses it like the rest of the UI.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, Teleport } from 'vue'
import ZenIconButton from '../primitives/ZenIconButton.vue'
import ZenScroll from '../primitives/ZenScroll.vue'
import ZenPopover from '../overlays/ZenPopover.vue'
import ZenSwitch from '../inputs/ZenSwitch.vue'
import ZenSlider from '../inputs/ZenSlider.vue'
import ZenMediaControls from './ZenMediaControls.vue'
import { safeMediaUrl } from '../lib/safeUrl'
import type { LightboxItem } from '../types'
import { openLayer, Z } from '../overlays/layers'

const props = withDefaults(
  defineProps<{
    items: LightboxItem[]
    index: number
    inline?: boolean // true = fill container; false = fullscreen overlay
    slideshowMs?: number
    /** Inline host's setting: in a slideshow, a video or audio plays to its end before moving on
     *  (only pictures use the time per slide). */
    slideshowToEnd?: boolean
    // Built-in chrome: shown unless 'none' (the host drives it via the exposed API — see
    // defineExpose below). 'none' also hides the nav zones. 'top' is accepted for compatibility.
    controls?: 'bottom' | 'top' | 'none'
  }>(),
  { inline: false, slideshowMs: 3000, slideshowToEnd: true, controls: 'bottom' },
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

// Click the backdrop around the picture (not the picture itself) to close — only when not
// zoomed in, so a pan-drag never closes it.
function onStageClick() {
  if (!props.inline && zoom.value === 1) emit('close')
}

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

// --- fit to stage ------------------------------------------------------------
// `.zlb-media` is max-width/max-height only, which fits media DOWN but never UP: a 512px clip on
// a 1400px stage renders at 512px, and since <video> also never received the zoom transform there
// was no way to make it bigger at all. Compute the fitted size instead, so media always grows to
// meet whichever edge it reaches first.
//
// It is applied as an explicit width/height rather than `width:100%;object-fit:contain` so the
// element's layout box still matches what you actually see. The stage closes on `@click.self`,
// and a full-bleed element would swallow every click in the letterbox.
const stageEl = ref<HTMLElement | null>(null)
const stageW = ref(0)
const natW = ref(0) // intrinsic media size; 0 until it loads
const natH = ref(0)
let stageRO: ResizeObserver | null = null
/** The floating bottom toolbar's height: a video's control bar sits above it, not under it. */
const footEl = ref<HTMLElement | null>(null)
const footH = ref(0)
let footRO: ResizeObserver | null = null
watch(footEl, (el) => {
  footRO?.disconnect()
  footH.value = el?.offsetHeight ?? 0
  if (!el) return
  footRO = new ResizeObserver(() => (footH.value = el.offsetHeight))
  footRO.observe(el)
})
onBeforeUnmount(() => footRO?.disconnect())

function measureStage() {
  const el = stageEl.value
  if (!el) return
  const cs = getComputedStyle(el)
  const px = (v: string) => parseFloat(v) || 0
  stageW.value = el.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight)
}

/** `loadedmetadata` for video, `load` for images — both give us the intrinsic size. */
function onMediaMeta(e: Event) {
  const t = e.target
  if (t instanceof HTMLVideoElement) {
    natW.value = t.videoWidth
    natH.value = t.videoHeight
  } else if (t instanceof HTMLImageElement) {
    natW.value = t.naturalWidth
    natH.value = t.naturalHeight
  }
}

/** Fitted size + the pan/zoom/rotate transform. Used by BOTH <img> and <video>. The size is in
 *  container units of the stage, so the browser refits it on every frame of a resize (the
 *  sidebar sliding, a panel being dragged) instead of a measurement behind. */
const mediaStyle = computed(() => {
  if (!natW.value || !natH.value) return imgStyle.value
  const ar = natW.value / natH.value
  return {
    width: `min(100cqw, ${100 * ar}cqh)`,
    height: `min(100cqh, ${100 / ar}cqw)`,
    ...imgStyle.value,
  }
})

// Re-fit whenever the stage appears or changes size (panel resize, window, thumb strip toggle).
watch(
  stageEl,
  (el) => {
    stageRO?.disconnect()
    stageRO = null
    if (!el) return
    measureStage()
    if (typeof ResizeObserver !== 'undefined') {
      stageRO = new ResizeObserver(() => measureStage())
      stageRO.observe(el)
    }
  },
  { immediate: true },
)
// A new source has a new intrinsic size; drop the old one so it can't fit against stale numbers.
watch(
  () => item.value?.src,
  () => {
    natW.value = 0
    natH.value = 0
  },
)

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
/** The current item's src, when it's safe to offer as a download (see lib/safeUrl). */
const downloadUrl = computed(() => safeMediaUrl(item.value?.src))
function download() {
  const it = item.value
  if (!it) return
  const a = document.createElement('a')
  const href = downloadUrl.value
  if (!href) return
  a.href = href
  a.download = (it.label || 'image').split('/').pop() || 'image'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/** Loading an image's workflow sends you to the graph, so the viewer gets out of the way. */
function loadWorkflow() {
  item.value?.onWorkflow?.()
  if (!props.inline) emit('close')
}

function go(i: number) {
  if (i < 0 || i >= count.value) return
  emit('update:index', i)
}
// The floating chrome fades out while the pointer rests, so it never sits over the picture for
// long; any movement brings it back.
const idle = ref(false)
let idleTimer: ReturnType<typeof setTimeout> | undefined
function wake() {
  idle.value = false
  clearTimeout(idleTimer)
  idleTimer = setTimeout(() => (idle.value = true), 2200)
}
onBeforeUnmount(() => clearTimeout(idleTimer))

// Decode the neighbouring pictures ahead of time, so a slide starts the moment you ask for it
// instead of waiting on the next image to load.
watch(
  () => props.index,
  (i) => {
    for (const n of [i + 1, i - 1]) {
      const it = props.items[n]
      if (it && (it.kind ?? 'image') === 'image') {
        const img = new Image()
        img.src = it.src
        void img.decode?.().catch(() => undefined)
      }
    }
  },
  { immediate: true },
)

// Which way the media slides when it changes: the way you moved (a loop back to the start counts
// as moving on).
// The slideshow always moves forward, even when shuffling to an earlier picture.
const direction = ref<'next' | 'prev'>('next')
/** The slideshow glides; stepping by hand is quicker, but never a snap. */
const slideDuration = ref(460)
let advancing = false
watch(
  () => props.index,
  (now, before) => {
    direction.value =
      !advancing && now < before && !(before === count.value - 1 && now === 0) ? 'prev' : 'next'
    slideDuration.value = advancing ? 700 : 460
    advancing = false
  },
  { flush: 'sync' },
)
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
// Wheel zoom keeps the point under the pointer where it is. The media is centred in the stage and
// transformed as translate(t) · rotate · scale(z) about its centre C, so a point at the pointer
// sits at d = pointer − C; zooming by f keeps it there when t' = d − f·(d − t).
function onWheel(e: WheelEvent) {
  e.preventDefault()
  const before = zoom.value
  const after = clampZoom(before * (e.deltaY < 0 ? 1.15 : 1 / 1.15))
  if (after === before) return
  zoom.value = after
  const media = stageEl.value?.querySelector<HTMLElement>('.zlb-media:last-of-type')
  const stage = stageEl.value?.getBoundingClientRect()
  if (after === 1 || !media || !stage) {
    if (after === 1) tx.value = ty.value = 0
    return
  }
  const f = after / before
  const dx = e.clientX - (stage.left + media.offsetLeft + media.offsetWidth / 2)
  const dy = e.clientY - (stage.top + media.offsetTop + media.offsetHeight / 2)
  tx.value = dx - f * (dx - tx.value)
  ty.value = dy - f * (dy - ty.value)
}
function onDblClick() {
  reset()
}
// --- video / audio ------------------------------------------------------------
// The element plays with no native controls: ZenMediaControls drives it from outside the zoom
// transform, so its bar stays full size, and a pan-drag works anywhere on a zoomed video in every
// browser (native controls swallow the press in some).
const mediaEl = ref<HTMLMediaElement | null>(null)
const mediaControls = ref<InstanceType<typeof ZenMediaControls> | null>(null)
function setMediaEl(el: unknown) {
  mediaEl.value = el instanceof HTMLMediaElement ? el : null
}
/** Set by a pan that actually moved, so the click ending it doesn't also toggle playback. */
let panned = false
function onMediaClick() {
  if (!panned) mediaControls.value?.toggle()
}

function startPan(e: PointerEvent) {
  panned = false
  if (zoom.value <= 1 || e.button !== 0) return
  e.preventDefault()
  const ox = e.clientX - tx.value
  const oy = e.clientY - ty.value
  const sx = e.clientX
  const sy = e.clientY
  const move = (m: PointerEvent) => {
    if (Math.hypot(m.clientX - sx, m.clientY - sy) > 3) panned = true
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
// One slide at a time: the countdown restarts whenever the picture changes, by hand or by the
// show, so the progress line always tells the truth. The overlay remembers its own speed and
// shuffle; an inline host (the Media Viewer) passes its speed in as `slideshowMs`.
/** Seconds per slide the slider offers. */
const SPEED = { min: 1, max: 30, step: 0.5 }
const SLIDE_KEY = 'zenkit.lightbox.slideshow'
function loadSlide(): { ms: number; shuffle: boolean; toEnd: boolean } {
  try {
    const saved = JSON.parse(localStorage.getItem(SLIDE_KEY) || '{}')
    const ms = Number(saved.ms)
    const ok = Number.isFinite(ms) && ms >= SPEED.min * 1000 && ms <= SPEED.max * 1000
    return { ms: ok ? ms : 3000, shuffle: saved.shuffle === true, toEnd: saved.toEnd !== false }
  } catch {
    return { ms: 3000, shuffle: false, toEnd: true }
  }
}
const slidePrefs = ref(loadSlide())
watch(
  slidePrefs,
  (v) => {
    try {
      localStorage.setItem(SLIDE_KEY, JSON.stringify(v))
    } catch {
      /* storage may be unavailable */
    }
  },
  { deep: true },
)
const slideMs = computed(() =>
  Math.max(500, props.inline ? props.slideshowMs : slidePrefs.value.ms),
)
const fmtSpeed = (ms: number) => `${ms / 1000}s`

const playing = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null
function tick() {
  if (count.value < 2) return
  advancing = true
  if (slidePrefs.value.shuffle && !props.inline) {
    const next = Math.floor(Math.random() * (count.value - 1))
    go(next >= props.index ? next + 1 : next)
  } else go(props.index < count.value - 1 ? props.index + 1 : 0) // loop
}
function stopTimer() {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}
function togglePlay() {
  playing.value = !playing.value
}
/** A video or audio slide that moves on when it ends, rather than on the clock. */
const waitsForEnd = computed(
  () =>
    playing.value &&
    (props.inline ? props.slideshowToEnd : slidePrefs.value.toEnd) &&
    (item.value?.kind === 'video' || item.value?.kind === 'audio'),
)
function syncTimer() {
  stopTimer()
  if (playing.value && !waitsForEnd.value) timer = setTimeout(tick, slideMs.value)
}
watch([playing, slideMs, () => props.index, waitsForEnd], syncTimer)
watch([mediaEl, waitsForEnd], ([m, wait], _, onCleanup) => {
  if (!m || !wait) return
  const next = () => tick()
  // A clip that can't play still moves on, after the usual time.
  const failed = () => {
    stopTimer()
    timer = setTimeout(tick, slideMs.value)
  }
  m.addEventListener('ended', next)
  m.addEventListener('error', failed)
  if (m.paused) void m.play().catch(failed)
  onCleanup(() => {
    m.removeEventListener('ended', next)
    m.removeEventListener('error', failed)
  })
})
/** Restarts the progress line's animation whenever the countdown restarts. */
const progressKey = computed(() => `${props.index}:${slideMs.value}:${playing.value}`)

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
  if (mediaControls.value?.onKey(e)) {
    e.preventDefault()
    return
  }
  switch (e.key) {
    case 'Escape':
      // only when the lightbox is the innermost layer — a menu opened over it closes first
      if (layer?.escape(e)) emit('close')
      else return
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
// The fullscreen overlay joins the layer stack (Escape + z-order); inline is part of its host.
const layer = props.inline ? null : openLayer(Z.lightbox)
onMounted(() => {
  if (!props.inline) window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  layer?.release()
  window.removeEventListener('keydown', onKey)
  stopTimer()
  sideRO?.disconnect()
  stageRO?.disconnect()
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
      :class="{ inline }"
      :data-zen-layer="inline ? undefined : ''"
      :style="layer ? { zIndex: layer.z } : undefined"
    >
      <Transition name="zlb-side">
        <aside
          v-if="showChrome && !inline && strip && count > 1"
          class="zlb-side"
          :style="{ flexBasis: sideWidth + 'px', '--zlb-side-w': sideWidth + 'px' }"
        >
          <div class="zlb-side-head">
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
                  type="button"
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
            <ZenIconButton
              icon="mdi mdi-magnify-minus-outline"
              title="Smaller thumbnails"
              @click.stop="zoomThumbs(-1)"
            />
            <ZenIconButton
              icon="mdi mdi-magnify-plus-outline"
              title="Larger thumbnails"
              @click.stop="zoomThumbs(1)"
            />
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
      </Transition>

      <div class="zlb-main" :class="{ idle: idle && !inline }" @pointermove="wake">
        <header v-if="showChrome" class="zlb-top">
          <div class="zlb-chrome zlb-info">
            <span v-if="item?.label" class="zlb-label">{{ item.label }}</span>
            <span class="zlb-pos">{{ count ? index + 1 : 0 }} / {{ count }}</span>
            <span v-if="item?.meta" class="zlb-meta">{{ item.meta }}</span>
          </div>
          <span class="zlb-grow" />
          <div class="zlb-chrome zlb-actions">
            <ZenIconButton
              v-if="item?.onWorkflow"
              icon="mdi mdi-sitemap-outline"
              title="Load this image's workflow"
              @click.stop="loadWorkflow"
            />
            <ZenIconButton
              v-if="!inline"
              icon="mdi mdi-close"
              title="Close (Esc)"
              @click="emit('close')"
            />
          </div>
        </header>

        <div
          ref="stageEl"
          class="zlb-stage"
          :class="{ 'has-mc': item?.kind === 'video' || item?.kind === 'audio' }"
          :style="{
            '--zlb-slide': `${stageW + 48}px`,
            '--zlb-slide-ms': `${slideDuration}ms`,
            '--zlb-foot': `${footH ? footH + 8 : 0}px`,
          }"
          @wheel="onWheel"
          @pointerdown="startPan"
          @dblclick="onDblClick"
          @click.self="onStageClick"
        >
          <button
            v-if="showChrome && zoom <= 1"
            type="button"
            class="zlb-nav prev"
            :disabled="!canPrev"
            title="Previous (Left)"
            @click.stop="go(index - 1)"
            @pointerdown.stop
          >
            <i class="mdi mdi-chevron-left" />
          </button>
          <Transition :name="`zlb-slide-${direction}`">
            <video
              v-if="item && item.kind === 'video'"
              :key="`v${index}`"
              :ref="setMediaEl"
              :src="item.src"
              class="zlb-media"
              :style="mediaStyle"
              autoplay
              loop
              playsinline
              draggable="false"
              @loadedmetadata="onMediaMeta"
              @click="onMediaClick"
            />
            <div v-else-if="item && item.kind === 'audio'" :key="`a${index}`" class="zlb-audio">
              <i class="mdi mdi-music-circle-outline" />
              <span v-if="item.label" class="zlb-audio-name">{{ item.label }}</span>
              <audio :ref="setMediaEl" :src="item.src" autoplay />
            </div>
            <img
              v-else-if="item"
              :key="index"
              :src="item.src"
              class="zlb-media"
              :style="mediaStyle"
              draggable="false"
              alt=""
              @load="onMediaMeta"
            />
            <div v-else class="zlb-empty"><i class="mdi mdi-image-off-outline" /></div>
          </Transition>
          <button
            v-if="showChrome && zoom <= 1"
            type="button"
            class="zlb-nav next"
            :disabled="!canNext"
            title="Next (Right)"
            @click.stop="go(index + 1)"
            @pointerdown.stop
          >
            <i class="mdi mdi-chevron-right" />
          </button>
          <ZenMediaControls
            v-if="mediaEl && (item?.kind === 'video' || item?.kind === 'audio')"
            ref="mediaControls"
            class="zlb-mc"
            :media="mediaEl"
            :compact="stageW < 420"
            :no-loop="waitsForEnd"
          />
        </div>

        <footer v-if="showChrome" ref="footEl" class="zlb-bottom">
          <div class="zlb-chrome zlb-tools">
            <span
              v-if="playing && !waitsForEnd"
              :key="progressKey"
              class="zlb-progress"
              :style="{ animationDuration: `${slideMs}ms` }"
            />
            <ZenIconButton
              v-if="count > 1 && !inline"
              icon="mdi mdi-view-grid-outline"
              title="Thumbnails"
              :active="strip"
              @click.stop="strip = !strip"
            />
            <template v-if="count > 1">
              <ZenIconButton
                :icon="playing ? 'mdi mdi-pause' : 'mdi mdi-play'"
                :title="playing ? 'Pause slideshow (Space)' : 'Play slideshow (Space)'"
                :active="playing"
                @click.stop="togglePlay"
              />
              <ZenPopover placement="top-start" :offset="10">
                <template #trigger="{ toggle, active }">
                  <button
                    type="button"
                    class="zlb-caret"
                    :class="{ on: active }"
                    title="Slideshow settings"
                    @click.stop="toggle"
                  >
                    <i class="mdi mdi-chevron-up" />
                  </button>
                </template>
                <div class="zlb-slidepop" @click.stop>
                  <div class="zlb-slidepop-row">
                    <span class="zlb-slidepop-label">Time per picture</span>
                    <div class="zlb-slidepop-speed">
                      <ZenSlider
                        :model-value="slidePrefs.ms / 1000"
                        :min="SPEED.min"
                        :max="SPEED.max"
                        :step="SPEED.step"
                        @update:model-value="(sec: number) => (slidePrefs.ms = sec * 1000)"
                      />
                      <span class="zlb-slidepop-value">{{ fmtSpeed(slidePrefs.ms) }}</span>
                    </div>
                  </div>
                  <label
                    class="zlb-slidepop-row inline"
                    title="Off: videos and audio get the time per slide too"
                  >
                    <span class="zlb-slidepop-label">Play videos to the end</span>
                    <ZenSwitch v-model="slidePrefs.toEnd" />
                  </label>
                  <label class="zlb-slidepop-row inline">
                    <span class="zlb-slidepop-label">Shuffle</span>
                    <ZenSwitch v-model="slidePrefs.shuffle" />
                  </label>
                </div>
              </ZenPopover>
            </template>
            <span class="zlb-sep" />
            <ZenIconButton
              icon="mdi mdi-rotate-left"
              title="Rotate left (Shift+R)"
              @click.stop="rotateBy(-90)"
            />
            <ZenIconButton
              icon="mdi mdi-rotate-right"
              title="Rotate right (R)"
              @click.stop="rotateBy(90)"
            />
            <span class="zlb-sep" />
            <ZenIconButton
              icon="mdi mdi-magnify-minus-outline"
              title="Zoom out (-)"
              @click.stop="zoomBy(1 / 1.2)"
            />
            <span class="zlb-zval">{{ Math.round(zoom * 100) }}%</span>
            <ZenIconButton
              icon="mdi mdi-magnify-plus-outline"
              title="Zoom in (+)"
              @click.stop="zoomBy(1.2)"
            />
            <ZenIconButton
              icon="mdi mdi-fit-to-screen-outline"
              title="Fit (0 / double-click)"
              @click.stop="reset"
            />
            <span class="zlb-sep" />
            <ZenIconButton
              v-if="downloadUrl"
              icon="mdi mdi-download"
              title="Download"
              @click.stop="download"
            />
          </div>
        </footer>
      </div>
    </div>
  </component>
</template>

<style scoped>
.zlb {
  position: fixed;
  inset: 0;
  z-index: 100300;
  display: flex;
  overflow: hidden;
  background: color-mix(in srgb, var(--zen-bg, #1a1a1f) 92%, transparent);
  backdrop-filter: blur(6px);
  font-family: var(--p-font-family, system-ui, sans-serif);
  color: var(--zen-text, #e5e5ea);
}
.zlb.inline {
  position: absolute;
  z-index: 1;
  border-radius: var(--zen-radius, 7px);
  background: var(--zen-bg, #1a1a1f);
}

.zlb-main {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

/* chrome: dressed exactly like ZenKit's floating taskbar, so themes style it the same way */
.zlb-chrome {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  background: color-mix(
    in srgb,
    var(--zen-chrome-bg, var(--zen-surface, #202026)) 94%,
    transparent
  );
  border: 1px solid var(--zen-surface-border, var(--zen-border, #34343c));
  border-radius: var(--zen-radius-surface, var(--zen-radius, 7px));
  box-shadow: var(--interface-floating-panel-shadow, 0 6px 18px rgba(0, 0, 0, 0.28));
  backdrop-filter: blur(12px);
}
.zlb-chrome .zen-iconbtn {
  width: 30px;
  height: 30px;
}
.zlb-top,
.zlb-bottom {
  position: absolute;
  left: 12px;
  right: 12px;
  z-index: 4;
  display: flex;
  gap: 8px;
  pointer-events: none;
  transition:
    opacity var(--zen-dur, 0.2s) ease,
    translate var(--zen-dur, 0.2s) ease;
}
.zlb-top > *,
.zlb-bottom > * {
  pointer-events: auto;
}
.zlb-top {
  top: 12px;
  align-items: flex-start;
}
.zlb-bottom {
  bottom: 12px;
  align-items: flex-end;
  justify-content: center;
  flex-wrap: wrap-reverse;
}
.zlb-main.idle .zlb-top {
  opacity: 0;
  translate: 0 -6px;
}
.zlb-main.idle .zlb-bottom {
  opacity: 0;
  translate: 0 6px;
}
.zlb-main.idle {
  cursor: none;
}
.zlb-grow {
  flex: 1;
}
.zlb-info {
  gap: 10px;
  min-width: 0;
  height: 38px;
  box-sizing: border-box;
  padding: 0 14px;
  font-size: 13px;
}
.zlb-label {
  font-weight: 600;
  color: var(--zen-text, #e5e5ea);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 40vw;
}
.zlb-pos,
.zlb-meta,
.zlb-zval {
  font-size: 11.5px;
  color: var(--zen-muted, #9aa0aa);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.zlb-zval {
  min-width: 40px;
  text-align: center;
}
.zlb-tools {
  position: relative;
  flex-wrap: wrap;
  justify-content: center;
  max-width: 100%;
  overflow: hidden;
}
/* time to the next slide, along the toolbar's bottom edge */
.zlb-progress {
  position: absolute;
  left: 0;
  bottom: 0;
  height: 2px;
  width: 100%;
  transform-origin: left;
  background: var(--zen-accent, #6366f1);
  animation: zlb-progress linear forwards;
}
@keyframes zlb-progress {
  from {
    transform: scaleX(0);
  }
  to {
    transform: scaleX(1);
  }
}
.zlb-caret {
  width: 18px;
  height: 30px;
  margin-left: -2px;
  padding: 0;
  cursor: pointer;
  color: var(--zen-muted, #9aa0aa);
  background: none;
  border: 1px solid transparent;
  border-radius: var(--zen-radius, 7px);
}
.zlb-caret:hover,
.zlb-caret.on {
  color: var(--zen-text, #e5e5ea);
  background: color-mix(in srgb, var(--zen-text, #e5e5ea) 12%, transparent);
}
.zlb-slidepop {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 10px 12px;
  min-width: 230px;
}
.zlb-slidepop-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.zlb-slidepop-row.inline {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
}
.zlb-slidepop-speed {
  display: flex;
  align-items: center;
  gap: 10px;
}
.zlb-slidepop-speed .zen-slider {
  flex: 1;
  min-width: 0;
}
.zlb-slidepop-value {
  min-width: 34px;
  text-align: right;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--zen-text, #e5e5ea);
}
.zlb-slidepop-label {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--zen-muted, #9aa0aa);
}
.zlb-sep {
  width: 1px;
  height: 18px;
  margin: 0 4px;
  background: var(--zen-surface-border, var(--zen-border, #34343c));
}

/* opening and closing: the card slides in from the left while the picture makes room */
.zlb-side.zlb-side-enter-active,
.zlb-side.zlb-side-leave-active {
  transition:
    translate var(--zen-dur, 0.2s) cubic-bezier(0.45, 0, 0.2, 1),
    margin-right var(--zen-dur, 0.2s) cubic-bezier(0.45, 0, 0.2, 1),
    opacity var(--zen-dur, 0.2s) ease;
}
.zlb-side.zlb-side-enter-from,
.zlb-side.zlb-side-leave-to {
  translate: calc(-100% - 12px) 0;
  margin-right: calc(-1 * (var(--zlb-side-w, 264px) + 12px));
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .zlb-side-enter-active,
  .zlb-side-leave-active {
    transition: none;
  }
}
/* the thumbnails: a floating card dressed like the rest of the chrome */
.zlb-side {
  position: relative;
  z-index: 5;
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
  margin: 12px 0 12px 12px;
  overflow: hidden;
  background: color-mix(
    in srgb,
    var(--zen-chrome-bg, var(--zen-surface, #202026)) 94%,
    transparent
  );
  border: 1px solid var(--zen-surface-border, var(--zen-border, #34343c));
  border-radius: var(--zen-radius-surface, var(--zen-radius, 7px));
  box-shadow: var(--interface-floating-panel-shadow, 0 6px 18px rgba(0, 0, 0, 0.28));
  backdrop-filter: blur(12px);
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
  background: color-mix(in srgb, var(--zen-accent, #6366f1) 45%, transparent);
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
  border-radius: var(--zen-radius, 7px);
  background: var(--zen-input, #1b1b20);
}
.zlb-search:focus-within {
  border-color: var(--zen-accent, #6366f1);
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
  border-radius: var(--zen-radius, 7px);
  background: var(--zen-input, #1b1b20);
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
  border-color: var(--zen-accent, #6366f1);
}
.zlb-cell.on {
  border-color: var(--zen-accent, #6366f1);
  box-shadow: 0 0 0 2px var(--zen-accent, #6366f1) inset;
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

/* stage: the picture fills it; its edges are the prev/next zones. A size container, so the
   media is fitted by CSS (`cqw`/`cqh`) on every frame. */
.zlb-stage {
  container-type: size;
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  padding: 16px;
}
/* Room under a video or audio for its control bar, which sits in the stage's own padding. */
.zlb-stage.has-mc {
  padding-bottom: calc(60px + var(--zlb-foot, 0px));
}
.zlb.inline .zlb-stage.has-mc {
  padding-bottom: 52px;
}
.zlb-mc {
  position: absolute;
  right: 12px;
  bottom: calc(8px + var(--zlb-foot, 0px));
  left: 12px;
  z-index: 3;
  max-width: 760px;
  margin: 0 auto;
}
.zlb.inline .zlb-stage {
  padding: 6px;
}
.zlb-media {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  display: block;
  border-radius: var(--zen-radius, 7px);
  box-shadow: 0 24px 60px -20px rgba(0, 0, 0, 0.55);
  transition: transform var(--zen-dur, 0.2s) linear;
}
.zlb.inline .zlb-media {
  box-shadow: none;
}
.zlb-empty {
  opacity: 0.4;
  font-size: 48px;
}
.zlb-audio {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: clamp(4px, 3cqh, 14px);
  padding: clamp(4px, 5cqh, 24px);
  max-width: 560px;
  width: 100%;
  color: var(--zen-text, #e5e5ea);
}
.zlb-audio .mdi {
  font-size: clamp(28px, 30cqh, 96px);
  line-height: 1;
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

/* prev/next: the middle of each edge. Invisible until hovered, then a soft glow in the primary
   colour (fading out top and bottom) and a chevron; hidden at the ends and while zoomed. */
.zlb-nav {
  position: absolute;
  top: 20%;
  bottom: 20%;
  z-index: 3;
  width: clamp(40px, 7%, 84px);
  display: flex;
  align-items: center;
  padding: 0 8px;
  border: none;
  color: #fff;
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--zen-dur, 0.2s) ease;
  mask-image: linear-gradient(to bottom, transparent, #000 30%, #000 70%, transparent);
}
.zlb-nav.prev {
  left: 0;
  justify-content: flex-start;
  background: linear-gradient(
    to right,
    color-mix(in srgb, var(--zen-accent, #6366f1) 20%, transparent),
    transparent
  );
}
.zlb-nav.next {
  right: 0;
  justify-content: flex-end;
  background: linear-gradient(
    to left,
    color-mix(in srgb, var(--zen-accent, #6366f1) 20%, transparent),
    transparent
  );
}
.zlb-nav:hover:not(:disabled) {
  opacity: 1;
}
.zlb-nav:disabled {
  display: none;
}
.zlb-nav .mdi {
  font-size: 28px;
  filter: drop-shadow(0 1px 4px rgba(0, 0, 0, 0.6));
  transition: translate var(--zen-dur, 0.2s) ease;
}
.zlb-nav.prev:hover .mdi {
  translate: -3px 0;
}
.zlb-nav.next:hover .mdi {
  translate: 3px 0;
}

/* the media slides the way you moved: a whole stage-width, like a carousel. `translate` (not
   `transform`) so it stacks with the inline zoom/rotate transform instead of replacing it. */
.zlb-slide-next-enter-active,
.zlb-slide-next-leave-active,
.zlb-slide-prev-enter-active,
.zlb-slide-prev-leave-active {
  transition: translate var(--zlb-slide-ms, 460ms) cubic-bezier(0.45, 0, 0.2, 1);
}
.zlb-slide-next-leave-active,
.zlb-slide-prev-leave-active {
  position: absolute;
}
.zlb-slide-next-enter-from,
.zlb-slide-prev-leave-to {
  translate: var(--zlb-slide, 100%) 0;
}
.zlb-slide-next-leave-to,
.zlb-slide-prev-enter-from {
  translate: calc(var(--zlb-slide, 100%) * -1) 0;
}
@media (prefers-reduced-motion: reduce) {
  .zlb-slide-next-enter-active,
  .zlb-slide-next-leave-active,
  .zlb-slide-prev-enter-active,
  .zlb-slide-prev-leave-active {
    transition: none;
  }
}
</style>
