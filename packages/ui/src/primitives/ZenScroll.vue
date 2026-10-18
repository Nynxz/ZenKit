<script setup lang="ts">
// ZenScroll — scroll container with themed scrollbars (works anywhere, not just inside a
// panel). Scrollbar look comes from the shared .zen-scroll stylesheet so it's identical
// everywhere it's used (including teleported menus/dialogs).
// `overlay`: the native bar is hidden (no gutter, so content never shifts when it starts or stops
// overflowing) and a themed thumb floats over the edge, shown on hover or while scrolling; drag
// it, or click the track to page. Scrolling stays native (wheel, touch, keys, scroll-into-view).
// The scrolling element is then an inner one: `viewport` (exposed) and the `scroll` event follow it.
import '../lib/scrollbar.css'
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

const props = withDefaults(defineProps<{ horizontal?: boolean; overlay?: boolean }>(), {
  horizontal: false,
  overlay: false,
})
const emit = defineEmits<{ scroll: [e: Event] }>()

const root = ref<HTMLElement | null>(null)
const inner = ref<HTMLElement | null>(null)
const X = props.horizontal
const pos = (el: HTMLElement) => (X ? el.scrollLeft : el.scrollTop)
const full = (el: HTMLElement) => (X ? el.scrollWidth : el.scrollHeight)
const span = (el: HTMLElement) => (X ? el.clientWidth : el.clientHeight)

// ---- the overlay bar -----------------------------------------------------------------------
const thumbAt = ref(0)
const thumbSize = ref(0)
const scrollable = ref(false)
const active = ref(false) // scrolled lately, or dragging: show the bar
const MIN_THUMB = 28
let idle: ReturnType<typeof setTimeout> | undefined
let ro: ResizeObserver | undefined
let dragging = false
let from = 0
let fromPos = 0

function measure() {
  const el = inner.value
  if (!el) return
  const [at, all, seen] = [pos(el), full(el), span(el)]
  scrollable.value = all > seen + 1
  const track = seen - 8
  thumbSize.value = Math.max(MIN_THUMB, (seen / all) * track)
  const max = all - seen
  thumbAt.value = 4 + (max > 0 ? (at / max) * (track - thumbSize.value) : 0)
}
function wake() {
  active.value = true
  clearTimeout(idle)
  idle = setTimeout(() => (active.value = dragging), 900)
}
function onScroll(e: Event) {
  if (props.overlay) {
    measure()
    wake()
  }
  emit('scroll', e)
}
function onThumbDown(e: PointerEvent) {
  if (!inner.value) return
  dragging = true
  from = X ? e.clientX : e.clientY
  fromPos = pos(inner.value)
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  e.preventDefault()
}
function onThumbMove(e: PointerEvent) {
  const el = inner.value
  if (!dragging || !el) return
  const ratio = (full(el) - span(el)) / Math.max(1, span(el) - 8 - thumbSize.value)
  const to = fromPos + ((X ? e.clientX : e.clientY) - from) * ratio
  if (X) el.scrollLeft = to
  else el.scrollTop = to
}
function onThumbUp() {
  dragging = false
  wake()
}
function onTrackDown(e: PointerEvent) {
  const el = inner.value
  if (!el || e.target !== e.currentTarget) return
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const dir = (X ? e.clientX - r.left : e.clientY - r.top) < thumbAt.value ? -1 : 1
  el.scrollBy({ [X ? 'left' : 'top']: dir * span(el) * 0.9, behavior: 'smooth' })
}

onMounted(async () => {
  if (!props.overlay) return
  await nextTick()
  measure()
  ro = new ResizeObserver(measure)
  if (inner.value) {
    ro.observe(inner.value)
    // content growing (images loading, a virtual list's pad) doesn't resize the viewport
    for (const child of Array.from(inner.value.children)) ro.observe(child)
  }
})
onBeforeUnmount(() => {
  ro?.disconnect()
  clearTimeout(idle)
})

defineExpose({
  /** the element that scrolls: the root, or with `overlay` the inner viewport */
  get viewport(): HTMLElement | null {
    return props.overlay ? inner.value : root.value
  },
  /** re-measure the overlay bar (after content changes it can't observe) */
  refresh: measure,
})
</script>

<template>
  <div
    v-if="overlay"
    ref="root"
    class="zen-scroll-ov"
    :class="{ x: horizontal, active, scrollable }"
  >
    <div ref="inner" class="zen-scroll zen-scroll-viewport" :class="{ x: horizontal }" @scroll.passive="onScroll">
      <slot />
    </div>
    <div v-show="scrollable" class="zen-scroll-track" @pointerdown="onTrackDown">
      <div
        class="zen-scroll-thumb"
        :style="
          horizontal
            ? { width: `${thumbSize}px`, transform: `translateX(${thumbAt}px)` }
            : { height: `${thumbSize}px`, transform: `translateY(${thumbAt}px)` }
        "
        @pointerdown.stop="onThumbDown"
        @pointermove="onThumbMove"
        @pointerup="onThumbUp"
        @pointercancel="onThumbUp"
      />
    </div>
  </div>
  <div v-else ref="root" class="zen-scroll" :class="{ x: horizontal }" @scroll.passive="onScroll">
    <slot />
  </div>
</template>

<style scoped>
/* layout only — scrollbar styling lives in scrollbar.css (.zen-scroll, global) */
.zen-scroll {
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}
.zen-scroll.x {
  overflow-x: auto;
  overflow-y: hidden;
}

/* overlay: the bar floats over the content's edge */
.zen-scroll-ov {
  position: relative;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
.zen-scroll-viewport {
  scrollbar-width: none;
}
.zen-scroll-viewport::-webkit-scrollbar {
  display: none;
}
.zen-scroll-track {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 12px;
  z-index: 4;
  opacity: 0;
  transition: opacity 0.2s ease;
}
.zen-scroll-ov:hover .zen-scroll-track,
.zen-scroll-ov.active .zen-scroll-track {
  opacity: 1;
}
.zen-scroll-thumb {
  position: absolute;
  top: 0;
  right: 3px;
  width: 6px;
  border-radius: var(--zen-radius-sm, 4px);
  background: var(--zen-scrollbar, color-mix(in srgb, var(--zen-text, #e5e5ea) 28%, transparent));
  transition:
    width 0.15s ease,
    right 0.15s ease,
    background 0.15s ease;
  touch-action: none;
  cursor: pointer;
}
.zen-scroll-track:hover .zen-scroll-thumb,
.zen-scroll-thumb:active {
  width: 8px;
  right: 2px;
  background: var(--zen-accent, #6366f1);
}
.zen-scroll-ov.x .zen-scroll-track {
  top: auto;
  left: 0;
  width: auto;
  height: 12px;
}
.zen-scroll-ov.x .zen-scroll-thumb {
  top: auto;
  right: auto;
  left: 0;
  bottom: 3px;
  width: auto;
  height: 6px;
}
.zen-scroll-ov.x .zen-scroll-track:hover .zen-scroll-thumb,
.zen-scroll-ov.x .zen-scroll-thumb:active {
  width: auto;
  right: auto;
  height: 8px;
  bottom: 2px;
}
</style>
