<script setup lang="ts">
import '../lib/motion.css'
import { onBeforeUnmount, ref } from 'vue'

// Geometry belongs to the host; the handle owns its appearance and input lifecycle.
const props = withDefaults(
  defineProps<{
    orientation?: 'vertical' | 'horizontal' | 'both'
    variant?: 'line' | 'gap'
    label: string
    value?: number
    min?: number
    max?: number
    valueText?: string
    controls?: string
    step?: number
    active?: boolean
  }>(),
  { orientation: 'vertical', variant: 'gap', step: 10 },
)
const emit = defineEmits<{
  dragStart: [event: PointerEvent]
  dragMove: [event: PointerEvent]
  dragEnd: [cancelled: boolean]
  nudge: [pixels: number, axis: 'x' | 'y']
  limit: [edge: 'min' | 'max']
  toggle: []
  reset: []
}>()
const dragging = ref(false)
let stop: ((cancelled: boolean) => void) | null = null

function start(event: PointerEvent) {
  if (event.button !== 0 || stop) return
  event.preventDefault()
  event.stopPropagation()
  const el = event.currentTarget as HTMLElement
  const id = event.pointerId
  const body = document.body
  const cursor = body.style.cursor
  const selection = body.style.userSelect
  body.style.cursor =
    props.orientation === 'both'
      ? 'move'
      : props.orientation === 'vertical'
        ? 'col-resize'
        : 'row-resize'
  body.style.userSelect = 'none'
  dragging.value = true
  const move = (e: PointerEvent) => {
    if (e.pointerId === id) emit('dragMove', e)
  }
  const up = (e: PointerEvent) => {
    if (e.pointerId === id) stop?.(false)
  }
  const cancel = (e: PointerEvent) => {
    if (e.pointerId === id) stop?.(true)
  }
  const key = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    stop?.(true)
  }
  stop = (cancelled) => {
    stop = null
    window.removeEventListener('pointermove', move, true)
    window.removeEventListener('pointerup', up, true)
    window.removeEventListener('pointercancel', cancel, true)
    window.removeEventListener('keydown', key, true)
    el.removeEventListener('lostpointercapture', cancel)
    if (el.hasPointerCapture(id)) el.releasePointerCapture(id)
    dragging.value = false
    body.style.cursor = cursor
    body.style.userSelect = selection
    emit('dragEnd', cancelled)
  }
  el.setPointerCapture(id)
  window.addEventListener('pointermove', move, true)
  window.addEventListener('pointerup', up, true)
  window.addEventListener('pointercancel', cancel, true)
  window.addEventListener('keydown', key, true)
  el.addEventListener('lostpointercapture', cancel)
  emit('dragStart', event)
}
function onKey(e: KeyboardEvent) {
  if (dragging.value || e.altKey || e.ctrlKey || e.metaKey) return
  const axis =
    e.key === 'ArrowLeft' || e.key === 'ArrowRight'
      ? 'x'
      : e.key === 'ArrowUp' || e.key === 'ArrowDown'
        ? 'y'
        : null
  if (
    axis &&
    (props.orientation === 'both' || axis === (props.orientation === 'vertical' ? 'x' : 'y'))
  ) {
    e.preventDefault()
    e.stopPropagation()
    const sign = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1
    emit('nudge', sign * props.step * (e.shiftKey ? 5 : 1), axis)
  } else if (
    e.key === 'Home' ||
    e.key === 'End' ||
    e.key === 'Enter' ||
    (e.key === ' ' && props.orientation === 'both')
  ) {
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Enter' || e.key === ' ') emit('toggle')
    else emit('limit', e.key === 'Home' ? 'min' : 'max')
  }
}
onBeforeUnmount(() => stop?.(true))
</script>

<template>
  <div
    class="zen-resize-handle"
    :class="[orientation, variant, { active: active || dragging }]"
    :role="orientation === 'both' ? 'button' : 'separator'"
    tabindex="0"
    :aria-label="label"
    :aria-orientation="orientation === 'both' ? undefined : orientation"
    :aria-controls="controls"
    :aria-valuenow="orientation === 'both' ? undefined : value"
    :aria-valuemin="orientation === 'both' ? undefined : min"
    :aria-valuemax="orientation === 'both' ? undefined : max"
    :aria-valuetext="orientation === 'both' ? undefined : valueText"
    @pointerdown="start"
    @keydown="onKey"
    @dblclick="emit('reset')"
  />
</template>

<style scoped>
.zen-resize-handle {
  position: relative;
  z-index: 1;
  flex: 0 0 8px;
  touch-action: none;
  user-select: none;
  background: transparent;
}
.vertical {
  cursor: col-resize;
}
.horizontal {
  cursor: row-resize;
}
.both {
  cursor: move;
}
.zen-resize-handle::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  border-radius: 999px;
  background: var(--zen-accent, #6366f1);
  opacity: 0;
  transition: opacity var(--zen-dur-fast, 0.12s) ease;
  pointer-events: none;
}
.vertical::after {
  width: 3px;
  height: 32px;
  max-height: calc(100% - 4px);
}
.horizontal::after {
  width: 32px;
  height: 3px;
  max-width: calc(100% - 4px);
}
.both::after {
  width: 8px;
  height: 8px;
}
.zen-resize-handle:hover::after,
.zen-resize-handle.active::after,
.zen-resize-handle:focus-visible::after {
  opacity: 1;
}
.zen-resize-handle:focus-visible {
  outline: 2px solid var(--zen-focus-ring, var(--zen-accent, #6366f1));
  outline-offset: 1px;
}
.line {
  flex-basis: 1px;
  background: var(--zen-border, #34343c);
  transition: background var(--zen-dur-fast, 0.12s) ease;
}
.line::before {
  content: '';
  position: absolute;
}
.line.vertical::before {
  inset: 0 -2.5px;
}
.line.horizontal::before {
  inset: -2.5px 0;
}
.line:hover,
.line.active {
  background: var(--zen-accent, #6366f1);
}
.line::after {
  display: none;
}
</style>
