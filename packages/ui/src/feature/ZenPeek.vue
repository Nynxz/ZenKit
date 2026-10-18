<script setup lang="ts">
// ZenPeek — hold Shift over a thumbnail to see it large: a picture at full size, a video playing,
// audio with a player, or content the host draws. Drop one inside the area it should cover; it
// watches the elements in that area that carry `data-peek` (a media URL), with `data-peek-kind`
// (image | video | audio, else guessed from the URL), `data-peek-label` and `data-peek-detail` for
// the caption. `data-peek-kind="custom"` with a `data-peek-id` asks the host instead: the `custom`
// slot, or the `render` prop, fills the window. Releasing Shift, Escape, or moving off the
// thumbnail puts it away. With `focus`, Shift over a focused element peeks too.
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import '../lib/surface.css'
import { openLayer, Z, type Layer } from '../overlays/layers'
import {
  peekTarget,
  placePeek,
  placePeekAbove,
  PEEK_SELECTOR,
  type PeekRender,
  type PeekTarget,
} from './peek'

const props = defineProps<{
  /** Draws `data-peek-kind="custom"` content (or use the `custom` slot). */
  render?: PeekRender
  /** Also peek at the focused element while Shift is held (keyboard users). */
  focus?: boolean
  /** Where the window opens: beside the element (default), or above it, for wide elements. */
  placement?: 'beside' | 'above'
}>()
defineSlots<{
  /** Custom content for `data-peek-kind="custom"`: `id` is its `data-peek-id`. */
  custom?: (p: { id: string; el: HTMLElement }) => unknown
}>()

interface Shown extends PeekTarget {
  el: HTMLElement
  rect: DOMRect
}

const anchor = ref<HTMLElement | null>(null)
const box = ref<HTMLElement | null>(null)
const customBox = ref<HTMLElement | null>(null)
const shown = ref<Shown | null>(null)
const pos = reactive({ left: 0, top: 0 })
const z = ref<number>(Z.peek)
let layer: Layer | null = null
let hovered: HTMLElement | null = null
let focused: HTMLElement | null = null
/** The keyboard moved focus since the pointer last moved: the focused element is the one to show. */
let byKeyboard = false
let shift = false
/** Escape put it away: it stays away until Shift is pressed again. */
let dismissed = false

function area(): HTMLElement | null {
  return anchor.value?.parentElement ?? null
}
function within(target: EventTarget | null): HTMLElement | null {
  const root = area()
  const el = target instanceof Element ? target.closest<HTMLElement>(PEEK_SELECTOR) : null
  return el && root?.contains(el) ? el : null
}

function hide() {
  shown.value = null
  layer?.release()
  layer = null
}

function update() {
  const el = shift && !dismissed ? (props.focus && byKeyboard ? focused : hovered) : null
  const target = el ? peekTarget(el.dataset) : null
  if (!el || !target) return hide()
  const rect = el.getBoundingClientRect()
  if (shown.value?.key === target.key && shown.value.rect.top === rect.top) return
  shown.value = { ...target, el, rect }
  if (!layer) {
    layer = openLayer(Z.peek)
    z.value = layer.z
  }
}

/** Beside the thumbnail, on whichever side has room (or above it); kept on screen. */
function place() {
  const s = shown.value
  const el = box.value
  if (!s || !el) return
  const viewport = { width: window.innerWidth, height: window.innerHeight }
  const at =
    props.placement === 'above'
      ? placePeekAbove(s.rect, el.offsetWidth, el.offsetHeight, viewport)
      : placePeek(s.rect, el.offsetWidth, el.offsetHeight, viewport)
  pos.left = at.left
  pos.top = at.top
}

// Custom content: drawn by `render` once its container is in the page, cleaned up when the peek
// closes or moves to something else.
let cleanup: (() => void) | null = null
function stopCustom() {
  const done = cleanup
  cleanup = null
  try {
    done?.()
  } catch (err) {
    console.warn('ZenPeek: a custom peek failed to clean up', err)
  }
}
const reduced = () => {
  const forced = document.documentElement.dataset.zenMotion // the host's setting wins (lib/motion.css)
  if (forced === 'reduce' || forced === 'full') return forced === 'reduce'
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}
watch(
  () => shown.value?.key,
  () => {
    stopCustom()
    const s = shown.value
    if (s?.kind === 'custom' && props.render && customBox.value) {
      try {
        const done = props.render(s.id, customBox.value, {
          el: s.el,
          reducedMotion: reduced(),
          place,
        })
        cleanup = typeof done === 'function' ? done : null
      } catch (err) {
        console.warn('ZenPeek: a custom peek failed to render', err)
      }
    }
    place()
  },
  { flush: 'post' },
)
// Placed again when it moves to another thumbnail, and whenever its size changes (a picture loading, custom content resizing).
watch(shown, place, { flush: 'post' })
let sizes: ResizeObserver | null = null
watch(box, (el, old) => {
  if (old) sizes?.unobserve(old)
  if (el) sizes?.observe(el)
})

function onMove(e: PointerEvent) {
  hovered = within(e.target)
  byKeyboard = false
  shift = e.shiftKey
  if (!shift) dismissed = false
  update()
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && e.type === 'keydown' && shown.value && layer?.escape(e)) {
    e.preventDefault()
    e.stopPropagation()
    dismissed = true
    return hide()
  }
  if (e.key !== 'Shift') return
  shift = e.type === 'keydown'
  if (!shift || !e.repeat) dismissed = false
  update()
}
function onFocusIn(e: FocusEvent) {
  focused = within(e.target)
  byKeyboard = true
  if (props.focus) update()
}
function onFocusOut(e: FocusEvent) {
  if (within(e.relatedTarget)) return
  focused = null
  if (props.focus) update()
}
function onBlur() {
  shift = false
  dismissed = false
  update()
}
/** A drag takes the pointer: the peek gets out of its way. */
function onDragStart() {
  hovered = null
  focused = null
  update()
}

// Capture phase: hosts that stop pointer events from bubbling (ComfyUI's Vue nodes do) would
// otherwise hide every hover inside them.
onMounted(() => {
  if (typeof ResizeObserver === 'function') sizes = new ResizeObserver(() => place())
  window.addEventListener('pointermove', onMove, { passive: true, capture: true })
  window.addEventListener('keydown', onKey, { capture: true })
  window.addEventListener('keyup', onKey, { capture: true })
  window.addEventListener('focusin', onFocusIn, { capture: true })
  window.addEventListener('focusout', onFocusOut, { capture: true })
  window.addEventListener('dragstart', onDragStart, { capture: true })
  window.addEventListener('blur', onBlur)
})
onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onMove, { capture: true })
  window.removeEventListener('keydown', onKey, { capture: true })
  window.removeEventListener('keyup', onKey, { capture: true })
  window.removeEventListener('focusin', onFocusIn, { capture: true })
  window.removeEventListener('focusout', onFocusOut, { capture: true })
  window.removeEventListener('dragstart', onDragStart, { capture: true })
  window.removeEventListener('blur', onBlur)
  sizes?.disconnect()
  stopCustom()
  hide()
})

const caption = computed(() => shown.value && (shown.value.label || shown.value.detail))
</script>

<template>
  <span ref="anchor" class="zen-peek-anchor" hidden />
  <Teleport to="body">
    <div
      v-if="shown"
      ref="box"
      class="zen-peek zen-surface"
      data-zen-layer
      :style="{ left: `${pos.left}px`, top: `${pos.top}px`, zIndex: z }"
    >
      <img v-if="shown.kind === 'image'" :src="shown.url" alt="" @load="place" />
      <video
        v-else-if="shown.kind === 'video'"
        :src="shown.url"
        autoplay
        muted
        loop
        playsinline
        @loadedmetadata="place"
      />
      <div v-else-if="shown.kind === 'audio'" class="zen-peek-audio">
        <i class="mdi mdi-waveform" />
        <audio :src="shown.url" controls autoplay />
      </div>
      <div v-else :key="shown.key" ref="customBox" class="zen-peek-custom">
        <slot name="custom" :id="shown.id" :el="shown.el" />
      </div>
      <div v-if="caption" class="zen-peek-caption">
        <b v-if="shown.label">{{ shown.label }}</b>
        <span v-if="shown.detail">{{ shown.detail }}</span>
      </div>
    </div>
  </Teleport>
</template>

<style>
.zen-peek {
  position: fixed;
  display: flex;
  flex-direction: column;
  max-width: min(560px, 60vw);
  overflow: hidden;
  border-radius: var(--zen-radius, 8px);
  pointer-events: none;
  animation: zen-peek-in var(--zen-dur-fast, 120ms) ease-out;
}
.zen-peek img,
.zen-peek video {
  display: block;
  max-width: min(560px, 60vw);
  max-height: min(480px, 70vh);
  object-fit: contain;
  background: var(--zen-media-bg, #0b0b0e);
}
.zen-peek-custom {
  display: block;
  max-width: min(560px, 60vw);
  max-height: min(480px, 70vh);
  overflow: hidden;
  background: var(--zen-media-bg, #0b0b0e);
}
.zen-peek-audio {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px;
  color: var(--zen-muted, #9aa0aa);
  font-size: 22px;
}
.zen-peek-caption {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-width: 100%;
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.4;
}
.zen-peek-caption span {
  color: var(--zen-muted, #9aa0aa);
}
@keyframes zen-peek-in {
  from {
    opacity: 0;
    transform: scale(0.97);
  }
}
/* reduced motion: the OS setting, unless the host forces full motion; or the host's own
   data-zen-motion="reduce" (see lib/motion.css) */
@media (prefers-reduced-motion: reduce) {
  :root:not([data-zen-motion='full']) .zen-peek {
    animation: none;
  }
}
:root[data-zen-motion='reduce'] .zen-peek {
  animation: none;
}
</style>
