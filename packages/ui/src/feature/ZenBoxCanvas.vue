<script setup lang="ts">
// ZenBoxCanvas — boxes over a canvas: draw them, move them, resize them, and paint a mask inside
// one. The host owns the boxes (v-model) and decides what a new one IS — the canvas only reports
// the rect that was drawn (`create`), which is what lets a region editor, a layout tool and a crop
// picker share it.
//
// Geometry lives in 0..1 canvas space (see lib/boxes.ts). Pointer positions are read against the
// stage's live bounding rect, which is post-transform, so the maths holds at any canvas zoom with
// no correction: a fraction of a scaled rect is the same fraction of the unscaled one.
//
// Live edits go out through `update:boxes` on every move so the host can draw them; `commit` fires
// once when a gesture ends, which is when a host should persist. Writing a saved graph on every
// pointermove would serialise it hundreds of times per drag.
//
// Masks are box-local: an image whose alpha is the shape, stretched over the box, so it moves and
// scales with it. Painting happens on one canvas laid over the box being painted, and the result
// goes out as a PNG data URL through `update:mask` when the stroke ends.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  BOX_HANDLES,
  boundsOf,
  boxAt,
  clamp01,
  intersects,
  moveRect,
  resizeRect,
  scaleWithin,
  spanRect,
  type BoxHandle,
  type BoxRect,
  type ZenBox,
} from '../lib/boxes'

export type BoxTool = 'select' | 'brush' | 'erase'

const props = withDefaults(
  defineProps<{
    /** Canvas width / height. */
    aspect?: number
    /** Image drawn under the boxes — a trace or a reference. */
    backdrop?: string | null
    backdropOpacity?: number
    /** Let a drag on empty canvas draw a new box (reported through `create`). */
    draw?: boolean
    /** Snap edges to multiples of this fraction while dragging. 0 = off; Alt suspends it. */
    snap?: number
    /** Brush diameter as a fraction of the canvas width. */
    brushSize?: number
    /** Brush edge softness, 0 (hard) to 1. */
    brushSoftness?: number
    showLabels?: boolean
    /** Faint lines every `grid` of the canvas. 0 = none. */
    grid?: number
    /** Smallest box `create` reports, as a fraction of either side. */
    minSize?: number
  }>(),
  {
    aspect: 1,
    backdrop: null,
    backdropOpacity: 1,
    draw: true,
    snap: 0,
    brushSize: 0.06,
    brushSoftness: 0.15,
    showLabels: true,
    grid: 0,
    minSize: 0.02,
  },
)

const boxes = defineModel<ZenBox[]>('boxes', { default: () => [] })
const selected = defineModel<string[]>('selected', { default: () => [] })
const tool = defineModel<BoxTool>('tool', { default: 'select' })

const emit = defineEmits<{
  /** A box was drawn on empty canvas. The host decides whether it becomes one. */
  create: [rect: BoxRect]
  /** A gesture ended (move, resize, nudge) — persist now. */
  commit: []
  /** A stroke ended on box `id`; `mask` is the new box-local mask, or null for "the whole box". */
  'update:mask': [id: string, mask: string | null]
  /** Delete was pressed with these boxes selected. */
  delete: [ids: string[]]
  /** A box was double-clicked. */
  open: [id: string]
}>()

/** Painting resolution. Box-local, so this is resolution across the BOX, not the canvas. */
const MASK_RES = 512
/** Stored resolution: what a host keeps. Masks feed token grids far coarser than this, and
 *  white-on-alpha at this size is a few KB as PNG where the painting canvas is tens. */
const STORE_RES = 256

const frame = ref<HTMLElement | null>(null)
const stage = ref<HTMLElement | null>(null)
const paintEl = ref<HTMLCanvasElement | null>(null)

// The stage is the largest box of the canvas's aspect that fits the frame — CSS aspect-ratio alone
// overflows whenever the frame is wider than that shape, so the size is measured instead. Layout
// sizes, not client rects: a zoomed graph canvas scales both the same, so they stay in step.
const fitted = ref({ width: 0, height: 0 })
let observer: ResizeObserver | null = null
function measure() {
  const el = frame.value
  if (!el) return
  const width = Math.min(el.clientWidth, el.clientHeight * props.aspect)
  fitted.value = { width, height: width / props.aspect }
}
onMounted(() => {
  observer = new ResizeObserver(measure)
  if (frame.value) observer.observe(frame.value)
  measure()
})
onBeforeUnmount(() => observer?.disconnect())
watch(() => props.aspect, measure)

const visible = computed(() => boxes.value.filter((b) => !b.hidden))
const selectedSet = computed(() => new Set(selected.value))
const primary = computed(() =>
  selected.value.length === 1 ? boxes.value.find((b) => b.id === selected.value[0]) : undefined,
)
const selectedBoxes = computed(() => boxes.value.filter((b) => selectedSet.value.has(b.id)))
const groupBounds = computed(() =>
  selectedBoxes.value.length > 1 ? boundsOf(selectedBoxes.value) : null,
)

// --- gestures --------------------------------------------------------------------------------

type Gesture =
  | { kind: 'draw'; ax: number; ay: number }
  | { kind: 'marquee'; ax: number; ay: number; base: string[] }
  | { kind: 'move'; ax: number; ay: number; starts: Map<string, BoxRect>; moved: boolean }
  | { kind: 'resize'; id: string; handle: BoxHandle; ax: number; ay: number; start: BoxRect }
  | {
      kind: 'group'
      handle: BoxHandle
      ax: number
      ay: number
      from: BoxRect
      starts: Map<string, BoxRect>
    }
  | { kind: 'paint'; id: string; erase: boolean; last: [number, number] | null }

let gesture: Gesture | null = null
const draft = ref<BoxRect | null>(null)
const marquee = ref<BoxRect | null>(null)
const painting = ref<string | null>(null)
const pointer = ref<[number, number] | null>(null)

function at(e: PointerEvent | MouseEvent): [number, number] {
  const rect = stage.value!.getBoundingClientRect()
  return [(e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height]
}

function setRects(rects: Map<string, BoxRect>) {
  boxes.value = boxes.value.map((b) => {
    const r = rects.get(b.id)
    return r ? { ...b, ...r } : b
  })
}

function onDown(e: PointerEvent) {
  if (e.button !== 0 || !stage.value) return
  stage.value.focus({ preventScroll: true })
  const [x, y] = at(e)
  const target = e.target as HTMLElement

  if (tool.value !== 'select') {
    const box =
      (primary.value && !primary.value.locked && inside(primary.value, x, y) && primary.value) ||
      boxAt(boxes.value, x, y)
    if (!box || box.locked) return
    selected.value = [box.id]
    startPaint(box, tool.value === 'erase', x, y)
    capture(e)
    return
  }

  const handle = target.closest<HTMLElement>('[data-handle]')
  if (handle) {
    const which = handle.dataset.handle as BoxHandle
    if (handle.dataset.group && groupBounds.value) {
      gesture = {
        kind: 'group',
        handle: which,
        ax: x,
        ay: y,
        from: groupBounds.value,
        starts: new Map(selectedBoxes.value.filter((b) => !b.locked).map((b) => [b.id, rectOf(b)])),
      }
    } else if (primary.value) {
      gesture = {
        kind: 'resize',
        id: primary.value.id,
        handle: which,
        ax: x,
        ay: y,
        start: rectOf(primary.value),
      }
    }
    capture(e)
    return
  }

  const boxEl = target.closest<HTMLElement>('[data-box-id]')
  const id = boxEl?.dataset.boxId
  if (id) {
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      selected.value = selectedSet.value.has(id)
        ? selected.value.filter((s) => s !== id)
        : [...selected.value, id]
      return
    }
    if (!selectedSet.value.has(id)) selected.value = [id]
    gesture = {
      kind: 'move',
      ax: x,
      ay: y,
      moved: false,
      starts: new Map(selectedBoxes.value.filter((b) => !b.locked).map((b) => [b.id, rectOf(b)])),
    }
    capture(e)
    return
  }

  if (e.shiftKey || e.ctrlKey || e.metaKey) {
    gesture = { kind: 'marquee', ax: x, ay: y, base: [...selected.value] }
  } else {
    selected.value = []
    if (props.draw) gesture = { kind: 'draw', ax: x, ay: y }
  }
  capture(e)
}

function onMove(e: PointerEvent) {
  if (!stage.value) return
  const [x, y] = at(e)
  pointer.value = [x, y]
  const g = gesture
  if (!g) return
  const step = e.altKey ? 0 : props.snap
  switch (g.kind) {
    case 'draw':
      draft.value = spanRect(g.ax, g.ay, x, y)
      break
    case 'marquee': {
      const area = spanRect(g.ax, g.ay, x, y)
      marquee.value = area
      const hit = visible.value.filter((b) => intersects(b, area)).map((b) => b.id)
      selected.value = [...new Set([...g.base, ...hit])]
      break
    }
    case 'move': {
      let dx = x - g.ax
      let dy = y - g.ay
      // Shift locks the move to whichever axis it has gone further along.
      if (e.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0
        else dx = 0
      }
      // One clamp for the whole selection, so a group stops at the edge as one rather than
      // squashing together as each member hits it.
      const all = boundsOf([...g.starts.values()])
      if (all) {
        dx = Math.min(1 - all.x - all.w, Math.max(-all.x, dx))
        dy = Math.min(1 - all.y - all.h, Math.max(-all.y, dy))
      }
      g.moved = g.moved || Math.abs(dx) + Math.abs(dy) > 0.002
      const next = new Map<string, BoxRect>()
      for (const [id, start] of g.starts) next.set(id, moveRect(start, dx, dy, step))
      setRects(next)
      break
    }
    case 'resize':
      setRects(
        new Map([
          [
            g.id,
            resizeRect(g.start, g.handle, x - g.ax, y - g.ay, {
              step,
              keepAspect: e.shiftKey,
              aspect: props.aspect,
            }),
          ],
        ]),
      )
      break
    case 'group': {
      const to = resizeRect(g.from, g.handle, x - g.ax, y - g.ay, {
        step,
        keepAspect: e.shiftKey,
        aspect: props.aspect,
      })
      const next = new Map<string, BoxRect>()
      for (const [id, start] of g.starts) next.set(id, scaleWithin(start, g.from, to))
      setRects(next)
      break
    }
    case 'paint':
      stroke(g, x, y)
      break
  }
}

function onUp() {
  const g = gesture
  gesture = null
  if (!g) return
  switch (g.kind) {
    case 'draw': {
      const rect = draft.value
      draft.value = null
      if (rect && rect.w >= props.minSize && rect.h >= props.minSize) emit('create', rect)
      break
    }
    case 'marquee':
      marquee.value = null
      break
    case 'move':
      if (g.moved) emit('commit')
      break
    case 'resize':
    case 'group':
      emit('commit')
      break
    case 'paint':
      endPaint(g.id)
      break
  }
}

function onDoubleClick(e: MouseEvent) {
  const id = (e.target as HTMLElement).closest<HTMLElement>('[data-box-id]')?.dataset.boxId
  if (id) emit('open', id)
}

function capture(e: PointerEvent) {
  try {
    stage.value?.setPointerCapture(e.pointerId)
  } catch {
    /* the pointer is already gone */
  }
}

function rectOf(b: BoxRect): BoxRect {
  return { x: b.x, y: b.y, w: b.w, h: b.h }
}
function inside(b: BoxRect, x: number, y: number) {
  return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h
}

// --- keys ------------------------------------------------------------------------------------

function onKey(e: KeyboardEvent) {
  const nudge = e.shiftKey ? 0.025 : 0.005
  const arrows: Record<string, [number, number]> = {
    ArrowLeft: [-nudge, 0],
    ArrowRight: [nudge, 0],
    ArrowUp: [0, -nudge],
    ArrowDown: [0, nudge],
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && selected.value.length) {
    emit('delete', [...selected.value])
  } else if (e.key === 'Escape') {
    selected.value = []
  } else if (e.key in arrows && selected.value.length) {
    const [dx, dy] = arrows[e.key]!
    const next = new Map<string, BoxRect>()
    for (const b of selectedBoxes.value) if (!b.locked) next.set(b.id, moveRect(b, dx, dy))
    setRects(next)
    emit('commit')
  } else if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
    selected.value = visible.value.map((b) => b.id)
  } else if (e.key === 'b' || e.key === 'e' || e.key === 'v') {
    tool.value = e.key === 'b' ? 'brush' : e.key === 'e' ? 'erase' : 'select'
  } else {
    return
  }
  // Ours — the graph would otherwise delete the NODE on Delete, or move on the arrows.
  e.preventDefault()
  e.stopPropagation()
}

// --- painting --------------------------------------------------------------------------------

const decoded = new Map<string, HTMLImageElement>()
/** Decode every mask ahead of time, so a stroke can start from it without waiting on a load. */
watch(
  () => boxes.value.map((b) => b.mask).filter((m): m is string => !!m),
  (masks) => {
    for (const url of masks) {
      if (decoded.has(url)) continue
      const img = new Image()
      img.src = url
      decoded.set(url, img)
    }
  },
  { immediate: true },
)

const paintRect = computed(() => boxes.value.find((b) => b.id === painting.value) ?? null)

function startPaint(box: ZenBox, erase: boolean, x: number, y: number) {
  const canvas = paintEl.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return
  canvas.width = MASK_RES
  canvas.height = MASK_RES
  ctx.clearRect(0, 0, MASK_RES, MASK_RES)
  const existing = box.mask ? decoded.get(box.mask) : undefined
  if (existing?.complete && existing.naturalWidth) {
    ctx.drawImage(existing, 0, 0, MASK_RES, MASK_RES)
  } else if (!box.mask && erase) {
    // No mask means "the whole box", so erasing starts from a full one.
    ctx.fillStyle = box.color ?? '#ffffff'
    ctx.fillRect(0, 0, MASK_RES, MASK_RES)
  }
  painting.value = box.id
  const g: Gesture = { kind: 'paint', id: box.id, erase, last: null }
  gesture = g
  stroke(g, x, y)
}

function stroke(g: Extract<Gesture, { kind: 'paint' }>, x: number, y: number) {
  const box = paintRect.value
  const ctx = paintEl.value?.getContext('2d')
  if (!box || !ctx || box.w <= 0 || box.h <= 0) return
  const u = ((x - box.x) / box.w) * MASK_RES
  const v = ((y - box.y) / box.h) * MASK_RES
  // A round brush on screen is an ellipse in box-local space whenever the box isn't square.
  const rx = Math.max(1, ((props.brushSize / box.w) * MASK_RES) / 2)
  const ry = Math.max(1, ((props.brushSize * props.aspect) / box.h) * (MASK_RES / 2))
  const [lu, lv] = g.last ?? [u, v]
  const dist = Math.hypot(u - lu, v - lv)
  const steps = Math.max(1, Math.ceil(dist / (Math.min(rx, ry) * 0.35)))
  ctx.globalCompositeOperation = g.erase ? 'destination-out' : 'source-over'
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    dab(ctx, lu + (u - lu) * t, lv + (v - lv) * t, rx, ry, box.color ?? '#ffffff')
  }
  g.last = [u, v]
}

function dab(
  ctx: CanvasRenderingContext2D,
  u: number,
  v: number,
  rx: number,
  ry: number,
  color: string,
) {
  ctx.save()
  ctx.translate(u, v)
  ctx.scale(1, ry / rx)
  const hard = 1 - clamp01(props.brushSoftness)
  const gradient = ctx.createRadialGradient(0, 0, rx * hard, 0, 0, rx)
  gradient.addColorStop(0, color)
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = hard >= 1 ? color : gradient
  ctx.beginPath()
  ctx.arc(0, 0, rx, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function endPaint(id: string) {
  const canvas = paintEl.value
  painting.value = null
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  const alpha = ctx?.getImageData(0, 0, MASK_RES, MASK_RES).data
  let full = !!alpha
  if (alpha) {
    for (let i = 3; i < alpha.length; i += 4) {
      if (alpha[i]! < 250) {
        full = false
        break
      }
    }
  }
  const url = full ? null : storable(canvas)
  if (url) {
    const img = new Image()
    img.src = url
    decoded.set(url, img)
  }
  emit('update:mask', id, url)
  emit('commit')
}

/** The painting as a white shape on transparency, at STORE_RES: the alpha is all a mask is. */
function storable(canvas: HTMLCanvasElement): string {
  const out = document.createElement('canvas')
  out.width = STORE_RES
  out.height = STORE_RES
  const ctx = out.getContext('2d')
  if (!ctx) return canvas.toDataURL('image/png')
  ctx.drawImage(canvas, 0, 0, STORE_RES, STORE_RES)
  ctx.globalCompositeOperation = 'source-in'
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, STORE_RES, STORE_RES)
  return out.toDataURL('image/png')
}

// --- drawing ---------------------------------------------------------------------------------

const pct = (v: number) => `${v * 100}%`
function rectStyle(r: BoxRect) {
  return { left: pct(r.x), top: pct(r.y), width: pct(r.w), height: pct(r.h) }
}
function boxStyle(b: ZenBox) {
  return { ...rectStyle(b), '--zbc-color': b.color ?? 'var(--zen-accent, #6366f1)' }
}
function fillStyle(b: ZenBox) {
  if (!b.mask) return undefined
  const image = `url("${b.mask}")`
  return { maskImage: image, WebkitMaskImage: image }
}

const showHandles = computed(
  () => tool.value === 'select' && !!primary.value && !primary.value.locked,
)
const brushRing = computed(() => {
  if (tool.value === 'select' || !pointer.value) return null
  const [x, y] = pointer.value
  const d = props.brushSize
  return {
    left: pct(x - d / 2),
    top: pct(y - (d * props.aspect) / 2),
    width: pct(d),
    height: pct(d * props.aspect),
  }
})
const gridStyle = computed(() =>
  props.grid > 0 ? { backgroundSize: `${props.grid * 100}% ${props.grid * 100}%` } : undefined,
)
</script>

<template>
  <div ref="frame" class="zbc-frame">
    <div
      ref="stage"
      class="zbc"
      :class="[`tool-${tool}`]"
      :style="{ width: `${fitted.width}px`, height: `${fitted.height}px` }"
      tabindex="-1"
      data-zen-drag
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
      @lostpointercapture="onUp"
      @pointerleave="pointer = null"
      @dblclick="onDoubleClick"
      @keydown="onKey"
      @contextmenu.prevent
    >
      <img
        v-if="backdrop"
        class="zbc-backdrop"
        :src="backdrop"
        :style="{ opacity: backdropOpacity }"
        draggable="false"
        alt=""
      />
      <div v-if="grid > 0" class="zbc-grid" :style="gridStyle" />

      <div
        v-for="(b, i) in visible"
        :key="b.id"
        class="zbc-box"
        :class="{
          sel: selectedSet.has(b.id),
          primary: primary?.id === b.id,
          locked: b.locked,
          masked: !!b.mask,
          painting: painting === b.id,
        }"
        :style="boxStyle(b)"
        :data-box-id="b.id"
      >
        <div v-if="$slots.box" class="zbc-content">
          <slot name="box" v-bind="{ box: b, index: i, maskStyle: fillStyle(b) }" />
        </div>
        <div class="zbc-fill" :style="fillStyle(b)" />
        <span v-if="showLabels" class="zbc-tag">
          <span class="zbc-n">{{ i + 1 }}</span>
          <span v-if="b.label" class="zbc-label">{{ b.label }}</span>
          <i v-if="b.locked" class="mdi mdi-lock" />
        </span>
        <template v-if="showHandles && primary?.id === b.id">
          <i v-for="h in BOX_HANDLES" :key="h" class="zbc-h" :class="`h-${h}`" :data-handle="h" />
        </template>
      </div>

      <canvas
        v-show="paintRect"
        ref="paintEl"
        class="zbc-paint"
        :style="paintRect ? rectStyle(paintRect) : undefined"
      />

      <div
        v-if="groupBounds && tool === 'select'"
        class="zbc-group"
        :style="rectStyle(groupBounds)"
      >
        <i
          v-for="h in BOX_HANDLES"
          :key="h"
          class="zbc-h"
          :class="`h-${h}`"
          :data-handle="h"
          data-group="1"
        />
      </div>

      <div v-if="draft" class="zbc-draft" :style="rectStyle(draft)" />
      <div v-if="marquee" class="zbc-marquee" :style="rectStyle(marquee)" />
      <div
        v-if="brushRing"
        class="zbc-ring"
        :class="{ erase: tool === 'erase' }"
        :style="brushRing"
      />
      <slot name="overlay" />
      <div v-if="!visible.length && $slots.empty" class="zbc-empty"><slot name="empty" /></div>
    </div>
  </div>
</template>

<style scoped>
/* The stage is absolutely placed so its measured size can never feed back into the frame's: a
   frame that grew to fit the stage would be measured larger, grow the stage, and so on. */
.zbc-frame {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
.zbc {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  overflow: hidden;
  border-radius: var(--zen-radius, 7px);
  background:
    repeating-conic-gradient(
        color-mix(in srgb, var(--zen-text, #fff) 4%, transparent) 0% 25%,
        transparent 0% 50%
      )
      0 0 / 16px 16px,
    var(--zen-input, #1b1b20);
  outline: 1px solid var(--zen-border, #34343c);
  /* Inside the stage: the frame clips anything past its edge, and the stage fills it exactly. */
  outline-offset: -1px;
  user-select: none;
  touch-action: none;
  cursor: crosshair;
}
.zbc:focus {
  outline: 1px solid color-mix(in srgb, var(--zen-text, #fff) 22%, transparent);
  outline-offset: -1px;
}
.zbc.tool-brush,
.zbc.tool-erase {
  cursor: none;
}
.zbc-backdrop {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
  pointer-events: none;
}
.zbc-grid {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(
      to right,
      color-mix(in srgb, var(--zen-text, #fff) 8%, transparent) 1px,
      transparent 1px
    ),
    linear-gradient(
      to bottom,
      color-mix(in srgb, var(--zen-text, #fff) 8%, transparent) 1px,
      transparent 1px
    );
}

.zbc-box {
  position: absolute;
  box-sizing: border-box;
  border: 1.5px solid var(--zbc-color);
  border-radius: 3px;
  cursor: move;
  transition: box-shadow 0.12s ease;
}
.zbc-box.masked {
  border-style: dashed;
}
.zbc-box.locked {
  cursor: default;
}
.zbc-box.sel {
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--zbc-color) 70%, transparent),
    0 0 14px color-mix(in srgb, var(--zbc-color) 40%, transparent);
}
.zbc-fill {
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--zbc-color) 22%, transparent);
  -webkit-mask-size: 100% 100%;
  mask-size: 100% 100%;
  pointer-events: none;
}
/* Host content inside a box (the `box` slot). Not clipped to the painted shape — the slot gets
   `maskStyle` to clip just what should be (a picture, not its caption). A size container, so the
   host can drop detail on small boxes with container queries. */
.zbc-content {
  position: absolute;
  inset: 0;
  overflow: hidden;
  container-type: size;
  pointer-events: none;
}
.zbc-box.painting .zbc-content {
  opacity: 0.35;
}
.zbc-box.masked .zbc-fill {
  background: color-mix(in srgb, var(--zbc-color) 45%, transparent);
}
.zbc-box.painting .zbc-fill {
  visibility: hidden;
}
.zbc-paint {
  position: absolute;
  opacity: 0.5;
  pointer-events: none;
}
.zbc-tag {
  position: absolute;
  left: -1px;
  top: -1px;
  display: flex;
  align-items: center;
  gap: 4px;
  max-width: calc(100% + 2px);
  padding: 1px 6px 1px 4px;
  border-radius: 3px 0 4px 0;
  background: var(--zbc-color);
  color: #fff;
  font-size: 10px;
  line-height: 15px;
  white-space: nowrap;
  overflow: hidden;
  text-shadow: 0 1px 1px rgb(0 0 0 / 35%);
  pointer-events: none;
}
.zbc-n {
  font-weight: 700;
}
.zbc-label {
  overflow: hidden;
  text-overflow: ellipsis;
}

.zbc-h {
  position: absolute;
  width: 9px;
  height: 9px;
  margin: -5px 0 0 -5px;
  border: 1.5px solid #fff;
  border-radius: 2px;
  background: var(--zbc-color, var(--zen-accent, #6366f1));
  box-shadow: 0 0 0 1px rgb(0 0 0 / 40%);
}
.h-nw {
  left: 0;
  top: 0;
  cursor: nwse-resize;
}
.h-n {
  left: 50%;
  top: 0;
  cursor: ns-resize;
}
.h-ne {
  left: 100%;
  top: 0;
  cursor: nesw-resize;
}
.h-e {
  left: 100%;
  top: 50%;
  cursor: ew-resize;
}
.h-se {
  left: 100%;
  top: 100%;
  cursor: nwse-resize;
}
.h-s {
  left: 50%;
  top: 100%;
  cursor: ns-resize;
}
.h-sw {
  left: 0;
  top: 100%;
  cursor: nesw-resize;
}
.h-w {
  left: 0;
  top: 50%;
  cursor: ew-resize;
}

.zbc-group {
  position: absolute;
  box-sizing: border-box;
  border: 1px dashed var(--zen-accent, #6366f1);
  pointer-events: none;
}
.zbc-group .zbc-h {
  pointer-events: auto;
  background: var(--zen-accent, #6366f1);
}
.zbc-draft,
.zbc-marquee {
  position: absolute;
  box-sizing: border-box;
  pointer-events: none;
}
.zbc-draft {
  border: 1.5px dashed var(--zen-text, #e5e5ea);
  background: color-mix(in srgb, var(--zen-text, #fff) 8%, transparent);
}
.zbc-marquee {
  border: 1px solid var(--zen-accent, #6366f1);
  background: color-mix(in srgb, var(--zen-accent, #6366f1) 12%, transparent);
}
.zbc-ring {
  position: absolute;
  box-sizing: border-box;
  border: 1.5px solid #fff;
  border-radius: 50%;
  box-shadow: 0 0 0 1px rgb(0 0 0 / 50%);
  pointer-events: none;
}
.zbc-ring.erase {
  border-style: dashed;
}
.zbc-empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--zen-muted, #9aa0aa);
  font-size: 12px;
  pointer-events: none;
}
</style>
