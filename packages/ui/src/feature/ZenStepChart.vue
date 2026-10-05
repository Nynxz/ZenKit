<template>
  <canvas
    ref="canvas"
    class="zsc"
    tabindex="0"
    :title="title"
    @pointermove="onMove"
    @pointerleave="onLeave"
    @pointerdown="onDown"
    @keydown="onKey"
  />
</template>

<script setup lang="ts">
// ZenStepChart — a sampler run as a chart you can scrub: the sigma schedule (dashed, the plan) and
// each step's change (filled, what happened), on a fixed axis of the run's step boundaries so the
// line grows left to right as steps land. Hover a point to look at that step, click to hold it
// (click again, or Escape, to follow the run again), arrow keys to step through.
//
// Boundaries: a run of N steps has N + 1 — 0 is the starting noise, N the finished image.
// `deltas[i]` is the change made BY step i + 1, so it is drawn at boundary i + 1.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    /** The schedule, one sigma per boundary. */
    sigmas?: number[] | null
    deltas?: number[]
    /** Boundaries in the whole run (steps + 1); fixes the x-axis. */
    total: number
    /** The newest boundary that has arrived. */
    current?: number
    /** Show the hovered step (`hover` follows the pointer). Off, the pointer only marks where it
     *  is, and a step is chosen by clicking or by dragging along the chart. */
    hoverScrub?: boolean
  }>(),
  { sigmas: null, deltas: () => [], current: -1, hoverScrub: true },
)
const hover = defineModel<number | null>('hover', { default: null })
const locked = defineModel<number | null>('locked', { default: null })

const canvas = ref<HTMLCanvasElement | null>(null)
const PAD_X = 4
const PAD_Y = 3
const LOCK = 'rgba(245, 200, 60, 0.9)'

const axis = computed(() =>
  Math.max(props.total, props.sigmas?.length ?? 0, props.deltas.length + 1, 2),
)
const title = computed(() =>
  locked.value !== null
    ? `Holding step ${locked.value} — click or Esc to follow the run`
    : props.hoverScrub
      ? 'Hover to look at a step · click to hold it · ←/→ to step'
      : 'Click a step to hold it · drag to scrub · ←/→ to step',
)

function stepAt(clientX: number): number {
  const r = canvas.value!.getBoundingClientRect()
  const f = (clientX - r.left - PAD_X) / Math.max(1, r.width - 2 * PAD_X)
  const i = Math.round(f * (axis.value - 1))
  return Math.max(0, Math.min(Math.max(0, props.current), i))
}
function setHover(i: number | null) {
  if (hover.value !== i) hover.value = i
}
/** Where the pointer is, drawn as a faint rule when it doesn't drive the view. */
const pointerAt = ref<number | null>(null)
function onMove(e: PointerEvent) {
  if (props.current < 0) return
  const i = stepAt(e.clientX)
  if (props.hoverScrub) setHover(i)
  else if (pointerAt.value !== i) pointerAt.value = i
}
function onLeave() {
  setHover(null)
  pointerAt.value = null
}
/** Click a step to hold it (the held one again to let go); press and drag to scrub through. */
function onDown(e: PointerEvent) {
  if (props.current < 0 || e.button !== 0) return
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  const sx = e.clientX
  const before = locked.value
  let dragged = false
  const move = (m: PointerEvent) => {
    if (!dragged && Math.abs(m.clientX - sx) < 3) return
    dragged = true
    locked.value = stepAt(m.clientX)
  }
  const up = (u: PointerEvent) => {
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', up)
    if (dragged) return
    const i = stepAt(u.clientX)
    locked.value = before === i ? null : i
  }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up)
}
function onKey(e: KeyboardEvent) {
  if (props.current < 0) return
  const from = locked.value ?? hover.value ?? props.current
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault()
    e.stopPropagation()
    locked.value = Math.max(0, Math.min(props.current, from + (e.key === 'ArrowRight' ? 1 : -1)))
  } else if (e.key === 'Escape' && locked.value !== null) {
    e.stopPropagation()
    locked.value = null
  }
}

function css(name: string, fallback: string) {
  return (canvas.value && getComputedStyle(canvas.value).getPropertyValue(name).trim()) || fallback
}

function draw() {
  const c = canvas.value
  if (!c) return
  const dpr = window.devicePixelRatio || 1
  const W = c.clientWidth
  const H = c.clientHeight
  if (!W || !H) return
  if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
    c.width = Math.round(W * dpr)
    c.height = Math.round(H * dpr)
  }
  const ctx = c.getContext('2d')!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, W, H)
  const grid = css('--zen-border', '#34343c')
  const sigmaColour = css('--zen-muted', '#9aa0aa')
  const deltaColour = css('--zen-accent', '#6366f1')
  const hoverColour = css('--zen-text', '#e5e5ea')
  const iW = W - 2 * PAD_X
  const iH = H - 2 * PAD_Y
  const xAt = (i: number) => PAD_X + (i / Math.max(1, axis.value - 1)) * iW

  ctx.strokeStyle = grid
  ctx.lineWidth = 1
  for (let g = 1; g < 4; g++) {
    const y = Math.round(PAD_Y + (g / 4) * iH) + 0.5
    ctx.beginPath()
    ctx.moveTo(PAD_X, y)
    ctx.lineTo(W - PAD_X, y)
    ctx.stroke()
  }

  const sig = props.sigmas
  if (sig && sig.length > 1) {
    const max = Math.max(...sig)
    const min = Math.min(0, ...sig)
    const yAt = (v: number) => PAD_Y + (1 - (v - min) / Math.max(max - min, 1e-6)) * iH
    ctx.strokeStyle = sigmaColour
    ctx.globalAlpha = 0.55
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    sig.forEach((v, i) => (i ? ctx.lineTo(xAt(i), yAt(v)) : ctx.moveTo(xAt(i), yAt(v))))
    ctx.stroke()
    ctx.setLineDash([])
    ctx.globalAlpha = 1
  }

  const d = props.deltas
  if (d.length) {
    const max = Math.max(...d.filter(Number.isFinite), 1e-6)
    const yAt = (v: number) => PAD_Y + (1 - v / max) * iH
    ctx.beginPath()
    ctx.moveTo(xAt(0), H - PAD_Y)
    ctx.lineTo(xAt(0), yAt(d[0]!))
    d.forEach((v, i) => ctx.lineTo(xAt(i + 1), yAt(v)))
    ctx.lineTo(xAt(d.length), H - PAD_Y)
    ctx.closePath()
    ctx.fillStyle = deltaColour
    ctx.globalAlpha = 0.16
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.strokeStyle = deltaColour
    ctx.lineWidth = 1.3
    ctx.beginPath()
    d.forEach((v, i) => (i ? ctx.lineTo(xAt(i + 1), yAt(v)) : ctx.moveTo(xAt(i + 1), yAt(v))))
    ctx.stroke()
  } else if (props.current >= 0) {
    // No change figures (core previews): mark each boundary that has arrived.
    ctx.fillStyle = deltaColour
    for (let i = 0; i <= props.current; i++) {
      ctx.beginPath()
      ctx.arc(xAt(i), H / 2, 2, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  const rule = (i: number, colour: string, dash: number[], alpha = 1) => {
    ctx.strokeStyle = colour
    ctx.globalAlpha = alpha
    ctx.setLineDash(dash)
    ctx.beginPath()
    ctx.moveTo(Math.round(xAt(i)) + 0.5, PAD_Y)
    ctx.lineTo(Math.round(xAt(i)) + 0.5, H - PAD_Y)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.globalAlpha = 1
  }
  if (locked.value !== null) rule(locked.value, LOCK, [4, 2])
  if (hover.value !== null) rule(hover.value, hoverColour, [], 0.5)
  else if (pointerAt.value !== null) rule(pointerAt.value, hoverColour, [2, 3], 0.3)
  else if (locked.value === null && props.current >= 0) rule(props.current, deltaColour, [], 0.8)
}

watch(
  () => [
    props.sigmas,
    props.deltas,
    props.total,
    props.current,
    hover.value,
    locked.value,
    pointerAt.value,
  ],
  draw,
  {
    deep: true,
  },
)
let ro: ResizeObserver | null = null
onMounted(() => {
  draw()
  if (canvas.value && typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => draw())
    ro.observe(canvas.value)
  }
})
onBeforeUnmount(() => ro?.disconnect())
</script>

<style scoped>
.zsc {
  display: block;
  width: 100%;
  height: 100%;
  outline: none;
  cursor: crosshair;
  touch-action: none;
}
/* keyboard focus only (arrow keys step through) — a click doesn't ring it */
.zsc:focus-visible {
  outline: 2px solid
    var(--zen-focus-ring, color-mix(in srgb, var(--zen-accent, #6366f1) 60%, transparent));
  outline-offset: -2px;
}
</style>
