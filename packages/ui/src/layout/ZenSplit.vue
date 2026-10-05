<script setup lang="ts">
// ZenSplit — resizable panes with draggable gutters. The monitor | inspector split and the
// bin / viewer / timeline stack, without each consumer re-deriving the pointer math.
//
//   <ZenSplit v-model:sizes="view.sizes" :panes="[{}, { size: 320, min: 260, collapsible: true }]">
//     <template #pane-0><Monitor /></template>
//     <template #pane-1><Inspector /></template>
//   </ZenSplit>
//
// Units are per pane, fixed by its config: `size` > 1 is px, 0–1 is a fraction of the flexible
// space (whatever the px panes and gutters leave), and no `size` takes an even share of what the
// fractions leave. `sizes` is in those same units, pane for pane; fractions are written back
// summing to 1. `min`/`max` are always px. If no pane is flexible, the last open pane grows.
//
// Every resize is a trade between the gutter's two neighbours — the other panes keep their pixel
// size. `update:sizes` fires once at the end of a drag, and on every keyboard step, double-click
// reset, and collapse/expand — never per pointermove, so it's safe to persist straight off it.
import { computed, ref, useId, watch } from 'vue'

export interface SplitPane {
  /** Initial size: > 1 = px, 0–1 = fraction of the flexible space, omitted = an even share. */
  size?: number
  /** Minimum, in px. */
  min?: number
  /** Maximum, in px. */
  max?: number
  /** Can be dragged (or Enter-toggled on its gutter) down to 0. */
  collapsible?: boolean
}

const props = withDefaults(
  defineProps<{
    /** `horizontal` = panes side by side (vertical gutters); `vertical` = stacked. */
    direction?: 'horizontal' | 'vertical'
    panes: SplitPane[]
    /** Arrow-key step in px; Shift moves 5×. */
    step?: number
    /** `line`: a 1px border between the panes. `gap`: an empty gap (for panes that draw their own
     *  panels) that shows a grip only on hover and while dragging. */
    gutter?: 'line' | 'gap'
  }>(),
  { direction: 'horizontal', step: 10, gutter: 'line' },
)

const sizes = defineModel<number[]>('sizes')

const horizontal = computed(() => props.direction === 'horizontal')
const isPx = (i: number) => (props.panes[i]?.size ?? 0) > 1

/** The configured sizes, with unsized panes filled in. This is what a reset goes back to. */
const initial = computed(() => {
  const n = props.panes.length
  const flex = props.panes.filter((_, i) => !isPx(i))
  const given = flex.reduce((a, p) => a + (p.size ?? 0), 0)
  const unsized = flex.filter((p) => p.size == null).length
  const share = unsized ? (given < 1 ? (1 - given) / unsized : 1 / flex.length) : 0
  return Array.from({ length: n }, (_, i) => props.panes[i]!.size ?? share)
})

const valid = (v: number[] | undefined): v is number[] =>
  Array.isArray(v) &&
  v.length === props.panes.length &&
  v.every((x) => Number.isFinite(x) && x >= 0)

// The live sizes. Separate from the model so a drag can update the layout every frame while the
// host only hears about it at the end.
const cur = ref<number[]>(valid(sizes.value) ? [...sizes.value] : initial.value)
let dragging = false
watch(
  () => [sizes.value, props.panes.length] as const,
  ([v]) => {
    if (!dragging) cur.value = valid(v) ? [...v] : initial.value
  },
)

function commit(next: number[]) {
  cur.value = next
  const prev = sizes.value
  if (!prev || prev.length !== next.length || prev.some((v, i) => v !== next[i])) {
    sizes.value = [...next]
  }
}

// --- layout ----------------------------------------------------------------------------------

const flexSum = computed(() => cur.value.reduce((a, v, i) => (isPx(i) ? a : a + v), 0))
/** With nothing flexible left open, the last open pane takes the slack so the split stays full. */
const filler = computed(() => {
  if (flexSum.value > 0) return -1
  for (let i = cur.value.length - 1; i >= 0; i--) if (cur.value[i]! > 0) return i
  return -1
})

function paneStyle(i: number) {
  const v = cur.value[i] ?? 0
  const grow = i === filler.value ? 1 : isPx(i) ? 0 : flexSum.value > 0 ? v / flexSum.value : 0
  const basis = isPx(i) ? `${v}px` : '0px'
  const min = v > 0 ? (props.panes[i]?.min ?? 0) : 0
  return {
    flex: `${grow} 1 ${basis}`,
    [horizontal.value ? 'minWidth' : 'minHeight']: `${min}px`,
  }
}

// --- the trade -------------------------------------------------------------------------------

const root = ref<HTMLElement | null>(null)
const paneEls: (HTMLElement | null)[] = []

/** Each pane's current size in layout px — offsetWidth ignores the canvas zoom transform. */
function measure(): number[] {
  return props.panes.map((_, i) => {
    const el = paneEls[i]
    return el ? (horizontal.value ? el.offsetWidth : el.offsetHeight) : 0
  })
}

/** Screen px per layout px. ComfyUI zooms the canvas with a CSS transform, so a raw pointer
 *  delta overshoots (zoomed in) or lags (zoomed out) unless divided by this. */
function cssScale(): number {
  const el = root.value
  if (!el) return 1
  const r = el.getBoundingClientRect()
  const s = horizontal.value ? r.width / el.offsetWidth : r.height / el.offsetHeight
  return Number.isFinite(s) && s > 0 ? s : 1
}

/** The pane a gutter "belongs" to: what its aria value reports, what Enter collapses and what a
 *  double-click resets. A px pane beside a flexible one; else a collapsible one; else the left. */
function primary(g: number): number {
  const a = g,
    b = g + 1
  if (isPx(b) && !isPx(a)) return b
  if (props.panes[b]?.collapsible && !props.panes[a]?.collapsible) return b
  return a
}

/** Give pane `p` (a neighbour of gutter `g`) `want` px, taken from or given to the other
 *  neighbour; clamps to both panes' min/max and snaps a collapsible pane shut past half its min. */
function trade(g: number, p: number, want: number, base: number[]): number[] {
  const o = p === g ? g + 1 : g
  const P = props.panes[p]!,
    O = props.panes[o]!
  const total = base[p]! + base[o]!
  const minP = P.min ?? 0,
    maxP = P.max ?? Infinity,
    minO = O.min ?? 0,
    maxO = O.max ?? Infinity
  let t: number
  if (P.collapsible && want < minP / 2 && total <= maxO) t = 0
  else if (O.collapsible && total - want < minO / 2 && total <= maxP) t = total
  else {
    const lo = Math.max(minP, total - maxO)
    const hi = Math.max(lo, Math.min(maxP, total - minO))
    t = Math.min(Math.max(want, lo), hi)
  }
  t = Math.min(Math.max(t, 0), total)

  const px = [...base]
  px[p] = t
  px[o] = total - t
  // Back to each pane's own units. Px panes the gesture didn't touch keep their stored value
  // (not a measurement that may include CSS shrink); fractions are re-derived from pixels.
  const flexPx = px.reduce((a, v, i) => (isPx(i) ? a : a + v), 0)
  return px.map((v, i) => {
    if (isPx(i)) return i === p || i === o ? Math.round(v) : cur.value[i]!
    return flexPx > 0 ? Math.round((v / flexPx) * 1e4) / 1e4 : 0
  })
}

/** Pane `p`'s configured size in px, given the current measurements. */
function initialPx(p: number, base: number[]): number {
  if (isPx(p)) return initial.value[p]!
  const flexPx = base.reduce((a, v, i) => (isPx(i) ? a : a + v), 0)
  const flexInit = initial.value.reduce((a, v, i) => (isPx(i) ? a : a + v), 0)
  return flexInit > 0 ? (initial.value[p]! / flexInit) * flexPx : 0
}

// Size before collapsing, so Enter / expand() reopens to where the pane was.
const lastPx: number[] = []

// --- pointer ---------------------------------------------------------------------------------

const active = ref(-1)
function onPointerDown(e: PointerEvent, g: number) {
  if (e.button !== 0) return
  e.preventDefault()
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  const base = measure()
  for (const i of [g, g + 1]) if (base[i]! > 0) lastPx[i] = base[i]!
  const start = horizontal.value ? e.clientX : e.clientY
  const scale = cssScale()
  dragging = true
  active.value = g

  const move = (m: PointerEvent) => {
    const d = ((horizontal.value ? m.clientX : m.clientY) - start) / scale
    cur.value = trade(g, g, base[g]! + d, base)
  }
  const end = () => {
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', end)
    el.removeEventListener('pointercancel', end)
    el.removeEventListener('lostpointercapture', end)
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
    dragging = false
    active.value = -1
    commit(cur.value)
  }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', end)
  el.addEventListener('pointercancel', end)
  el.addEventListener('lostpointercapture', end)
}

function onDblClick(g: number) {
  const base = measure()
  const p = primary(g)
  commit(trade(g, p, initialPx(p, base), base))
}

// --- keyboard --------------------------------------------------------------------------------

function onKeyDown(e: KeyboardEvent, g: number) {
  const base = measure()
  const p = primary(g)
  // +1 = move the gutter toward the end, which grows the left/top pane.
  const dir =
    e.key === (horizontal.value ? 'ArrowRight' : 'ArrowDown')
      ? 1
      : e.key === (horizontal.value ? 'ArrowLeft' : 'ArrowUp')
        ? -1
        : 0
  let next: number[] | null = null
  if (dir) {
    const step = props.step * (e.shiftKey ? 5 : 1)
    next = trade(g, p, base[p]! + dir * step * (p === g ? 1 : -1), base)
  } else if (e.key === 'Home') {
    next = trade(g, g, props.panes[g]!.min ?? 0, base)
  } else if (e.key === 'End') {
    next = trade(g, g + 1, props.panes[g + 1]!.min ?? 0, base)
  } else if (e.key === 'Enter' && props.panes[p]!.collapsible) {
    next = collapsedTo(g, p, base[p]! > 0, base)
  }
  if (!next) return
  e.preventDefault()
  commit(next)
}

function collapsedTo(g: number, p: number, shut: boolean, base: number[]): number[] {
  if (shut) {
    if (base[p]! > 0) lastPx[p] = base[p]!
    return trade(g, p, 0, base)
  }
  return trade(g, p, lastPx[p] ?? initialPx(p, base), base)
}

// --- aria ------------------------------------------------------------------------------------

function aria(g: number) {
  const p = primary(g)
  const v = cur.value[p] ?? 0
  const cfg = props.panes[p]!
  if (!isPx(p)) {
    const pct = Math.round((flexSum.value > 0 ? v / flexSum.value : 0) * 100)
    return { p, now: pct, min: 0, max: 100, text: `${pct}%` }
  }
  return {
    p,
    now: Math.round(v),
    min: cfg.collapsible ? 0 : (cfg.min ?? 0),
    max: cfg.max,
    text: `${Math.round(v)}px`,
  }
}

const uid = useId()
const paneId = (i: number) => `${uid}-pane-${i}`

// --- exposed ---------------------------------------------------------------------------------

/** Back to the configured sizes (all panes). Emits update:sizes. */
function reset() {
  commit([...initial.value])
}
/** Collapse (`true`) or reopen (`false`) a collapsible pane through its adjacent gutter. */
function collapse(i: number, shut = true) {
  if (!props.panes[i]?.collapsible) return
  const g = i < props.panes.length - 1 && (i === 0 || primary(i) === i) ? i : i - 1
  if (g < 0) return
  commit(collapsedTo(g, i, shut, measure()))
}
defineExpose({ el: root, reset, collapse })
</script>

<template>
  <div
    ref="root"
    class="zen-split"
    :class="[direction, `gutter-${gutter}`, { dragging: active >= 0 }]"
  >
    <template v-for="(_, i) in panes" :key="i">
      <div
        :id="paneId(i)"
        :ref="(el) => (paneEls[i] = el as HTMLElement | null)"
        class="zsp-pane"
        :class="{ collapsed: (cur[i] ?? 0) <= 0 }"
        :style="paneStyle(i)"
        :inert="(cur[i] ?? 0) <= 0 || undefined"
      >
        <slot :name="`pane-${i}`" />
      </div>
      <div
        v-if="i < panes.length - 1"
        class="zsp-gutter"
        :class="{ active: active === i }"
        role="separator"
        tabindex="0"
        :aria-orientation="horizontal ? 'vertical' : 'horizontal'"
        :aria-controls="paneId(aria(i).p)"
        :aria-valuenow="aria(i).now"
        :aria-valuemin="aria(i).min"
        :aria-valuemax="aria(i).max"
        :aria-valuetext="aria(i).text"
        :aria-label="`Resize pane ${aria(i).p + 1}`"
        @pointerdown.stop="onPointerDown($event, i)"
        @dblclick="onDblClick(i)"
        @keydown="onKeyDown($event, i)"
      />
    </template>
  </div>
</template>

<style scoped>
.zen-split {
  display: flex;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}
.zen-split.vertical {
  flex-direction: column;
}
/* No text selection, and the resize cursor everywhere, for the length of a drag. */
.zen-split.dragging {
  user-select: none;
}
.zen-split.horizontal.dragging {
  cursor: col-resize;
}
.zen-split.vertical.dragging {
  cursor: row-resize;
}

.zsp-pane {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.zsp-pane.collapsed {
  visibility: hidden;
}

/* A 1px line in the layout; the ::before widens the hit area to 6px without taking any room. */
.zsp-gutter {
  position: relative;
  z-index: 1;
  flex: 0 0 1px;
  background: var(--zen-border, #34343c);
  touch-action: none;
  transition:
    background 0.12s ease,
    box-shadow 0.12s ease;
}
.zsp-gutter::before {
  content: '';
  position: absolute;
}
.zen-split.horizontal > .zsp-gutter {
  cursor: col-resize;
}
.zen-split.horizontal > .zsp-gutter::before {
  inset: 0 -2.5px;
}
.zen-split.vertical > .zsp-gutter {
  cursor: row-resize;
}
.zen-split.vertical > .zsp-gutter::before {
  inset: -2.5px 0;
}
.zsp-gutter:hover,
.zsp-gutter.active {
  background: var(--zen-accent, #6366f1);
  box-shadow: 0 0 0 1px var(--zen-accent, #6366f1);
}
.zsp-gutter:focus-visible {
  outline: 2px solid
    var(--zen-focus-ring, color-mix(in srgb, var(--zen-accent, #6366f1) 60%, transparent));
  outline-offset: 1px;
}

.zen-split.gutter-gap > .zsp-gutter {
  flex-basis: 8px;
  background: transparent;
  box-shadow: none;
}
.zen-split.gutter-gap > .zsp-gutter::before {
  inset: 0;
}
.zen-split.gutter-gap > .zsp-gutter::after {
  content: '';
  position: absolute;
  inset: 50% auto auto 50%;
  border-radius: 999px;
  background: var(--zen-accent, #6366f1);
  opacity: 0;
  transform: translate(-50%, -50%);
  transition: opacity 0.12s ease;
}
.zen-split.gutter-gap.horizontal > .zsp-gutter::after {
  width: 3px;
  height: 32px;
}
.zen-split.gutter-gap.vertical > .zsp-gutter::after {
  width: 32px;
  height: 3px;
}
.zen-split.gutter-gap > .zsp-gutter:hover::after,
.zen-split.gutter-gap > .zsp-gutter.active::after {
  opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
  .zen-split.gutter-gap > .zsp-gutter::after,
  .zsp-gutter {
    transition: none;
  }
}
</style>
