<script setup lang="ts">
// ZenCompare — two images in one frame, as ComfyUI's template thumbnails do it:
//   mode="slider"   a divider follows the pointer: `before` left of it, `after` right
//                   (keyboard: ←/→ while focused); rests at `rest` (0–1) when the pointer leaves
//   mode="dissolve" `before`, crossfading to `after` while hovered
// Labels are optional corner tags. The images fill the frame, cropped (`fit="cover"`), or show
// whole and letterboxed (`fit="contain"`): two pictures of another shape than the frame then
// still line up.
// `track-closest` (a selector) lets the nearest matching ancestor — a card around it — drive the
// divider too: past the picture's edge it pins to that side, and it rests only when the pointer
// leaves that ancestor.
//
//   <ZenCompare :before="plain" :after="styled" before-label="Before" after-label="After" />
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const props = withDefaults(
  defineProps<{
    before: string
    after: string
    mode?: 'slider' | 'dissolve'
    beforeLabel?: string
    afterLabel?: string
    /** where the divider sits with no pointer over it (0 = all `after`, 1 = all `before`) */
    rest?: number
    alt?: string
    /** a selector: the closest ancestor matching it also moves the divider (see above) */
    trackClosest?: string
    /** the images cropped to fill the frame, or whole and letterboxed */
    fit?: 'cover' | 'contain'
  }>(),
  { mode: 'slider', rest: 0.5, alt: '', fit: 'cover' },
)

const split = ref<number | null>(null)
const at = computed(() => split.value ?? props.rest)
const hovering = ref(false)

const root = ref<HTMLElement | null>(null)
function onMove(e: PointerEvent) {
  if (props.mode !== 'slider' || !root.value) return
  const r = root.value.getBoundingClientRect()
  split.value = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
}
function onLeave() {
  split.value = null
  hovering.value = false
}
let area: HTMLElement | null = null
const tracked = ref(false) // an ancestor drives it: the picture's own events bubble up to that
const onAreaEnter = () => (hovering.value = true)
onMounted(() => {
  area = props.trackClosest
    ? (root.value?.parentElement?.closest<HTMLElement>(props.trackClosest) ?? null)
    : null
  tracked.value = !!area
  area?.addEventListener('pointermove', onMove)
  area?.addEventListener('pointerenter', onAreaEnter)
  area?.addEventListener('pointerleave', onLeave)
})
onBeforeUnmount(() => {
  area?.removeEventListener('pointermove', onMove)
  area?.removeEventListener('pointerenter', onAreaEnter)
  area?.removeEventListener('pointerleave', onLeave)
})
function onKey(e: KeyboardEvent) {
  if (props.mode !== 'slider' || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
  e.preventDefault()
  split.value = Math.min(1, Math.max(0, at.value + (e.key === 'ArrowLeft' ? -0.05 : 0.05)))
}
</script>

<template>
  <div
    ref="root"
    class="zen-compare"
    :class="[mode, { hovering, moving: split !== null, contain: fit === 'contain' }]"
    :style="{ '--split': `${at * 100}%` }"
    :tabindex="mode === 'slider' ? 0 : undefined"
    role="img"
    :aria-label="alt || `${beforeLabel ?? 'Before'} / ${afterLabel ?? 'After'}`"
    @pointermove="tracked || onMove($event)"
    @pointerenter="hovering = true"
    @pointerleave="tracked || onLeave()"
    @keydown="onKey"
    @blur="split = null"
  >
    <img class="zc-after" :src="after" alt="" draggable="false" loading="lazy" />
    <img class="zc-before" :src="before" alt="" draggable="false" loading="lazy" />
    <template v-if="mode === 'slider'">
      <span class="zc-line" aria-hidden="true">
        <span class="zc-knob"><i class="mdi mdi-unfold-more-vertical" /></span>
      </span>
    </template>
    <span v-if="beforeLabel" class="zc-tag left">{{ beforeLabel }}</span>
    <span v-if="afterLabel" class="zc-tag right">{{ afterLabel }}</span>
  </div>
</template>

<style scoped>
.zen-compare {
  position: relative;
  overflow: hidden;
  width: 100%;
  height: 100%;
  user-select: none;
  touch-action: pan-y;
  background: var(--zen-surface-2, #222);
}
.zen-compare img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  pointer-events: none;
}
.zen-compare.contain img {
  object-fit: contain;
}
.slider .zc-before {
  clip-path: inset(0 calc(100% - var(--split)) 0 0);
}
.slider:not(.moving) .zc-before,
.slider:not(.moving) .zc-line {
  transition:
    clip-path var(--zen-dur, 0.2s) ease,
    left var(--zen-dur, 0.2s) ease;
}
.dissolve .zc-before {
  transition: opacity 0.45s ease;
}
.dissolve.hovering .zc-before {
  opacity: 0;
}
.zc-line {
  position: absolute;
  top: 0;
  bottom: 0;
  left: var(--split);
  width: 2px;
  margin-left: -1px;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 0 6px rgba(0, 0, 0, 0.4);
  pointer-events: none;
}
.zc-knob {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 22px;
  height: 22px;
  transform: translate(-50%, -50%) rotate(90deg);
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: rgba(255, 255, 255, 0.95);
  color: #222;
  font-size: 14px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
  opacity: 0;
  transition: opacity var(--zen-dur-fast, 0.12s);
}
.hovering .zc-knob,
.zen-compare:focus-visible .zc-knob {
  opacity: 1;
}
.zc-tag {
  position: absolute;
  bottom: 8px;
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  backdrop-filter: blur(4px);
  pointer-events: none;
  opacity: 0;
  transition: opacity var(--zen-dur-fast, 0.12s);
}
.hovering .zc-tag {
  opacity: 1;
}
.zc-tag.left {
  left: 8px;
}
.zc-tag.right {
  right: 8px;
}
.zen-compare:focus-visible {
  outline: 2px solid
    var(--zen-focus-ring, color-mix(in srgb, var(--zen-accent, #6366f1) 60%, transparent));
  outline-offset: -2px;
}
</style>
