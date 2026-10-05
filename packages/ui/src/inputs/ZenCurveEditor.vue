<template>
  <div class="zce">
    <div class="zce-box">
      <svg
        ref="svg"
        class="zce-svg"
        :viewBox="`0 0 ${W} ${H}`"
        preserveAspectRatio="none"
        @dblclick="add"
      >
        <line
          v-for="g in [0.25, 0.5, 0.75]"
          :key="g"
          class="zce-grid"
          :x1="0"
          :x2="W"
          :y1="g * H"
          :y2="g * H"
        />
        <line v-if="unit !== null" class="zce-unit" :x1="0" :x2="W" :y1="py(unit)" :y2="py(unit)" />
        <polygon class="zce-area" :points="area" />
        <polyline class="zce-line" :points="line" />
      </svg>
      <!-- points as HTML so they stay round at any box shape -->
      <span
        v-for="(p, i) in model"
        :key="i"
        class="zce-pt"
        :style="{ left: `${(p.x / 1) * 100}%`, top: `${(py(p.y) / H) * 100}%` }"
        :title="`${p.y.toFixed(2)} at ${Math.round(p.x * 100)}%`"
        @pointerdown.stop="drag($event, i)"
        @dblclick.stop
        @contextmenu.prevent.stop="remove(i)"
      />
    </div>
    <div class="zce-axis">
      <span>{{ xLabels[0] }}</span>
      <span>{{ xLabels[1] }}</span>
    </div>
    <div v-if="presets.length" class="zce-presets">
      <button
        v-for="p in presets"
        :key="p.label"
        type="button"
        class="zce-preset"
        :title="p.title ?? p.label"
        @click="model = p.points.map((q) => ({ ...q }))"
      >
        <i v-if="p.icon" :class="p.icon" />
        {{ p.label }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
// ZenCurveEditor — a value over 0–1, drawn as points you drag (x along, y up), double-click to
// add one, right-click one to remove it. Between points it's linear, and held flat past the ends.
// `presets` are one-click shapes. Works in CSS pixels of its own box, so it is right however the
// page or a canvas node scales it.
import { computed, ref } from 'vue'

export interface CurvePoint {
  x: number
  y: number
}
export interface CurvePreset {
  label: string
  icon?: string
  title?: string
  points: CurvePoint[]
}

const model = defineModel<CurvePoint[]>({ default: () => [] })
const props = withDefaults(
  defineProps<{
    min?: number
    max?: number
    /** Drawn as a faint guide line (e.g. 1 for "unchanged"); null for none. */
    unit?: number | null
    /** Value shown while there are no points. */
    flat?: number
    xLabels?: [string, string]
    presets?: CurvePreset[]
  }>(),
  { min: 0, max: 1, unit: null, flat: 1, xLabels: () => ['start', 'end'], presets: () => [] },
)

const W = 200
const H = 80
const svg = ref<SVGSVGElement | null>(null)
const py = (y: number) =>
  (1 - (Math.min(props.max, Math.max(props.min, y)) - props.min) / (props.max - props.min)) * H
const held = computed(() => {
  const pts = [...model.value].sort((a, b) => a.x - b.x)
  if (!pts.length)
    return [
      { x: 0, y: props.flat },
      { x: 1, y: props.flat },
    ]
  return [{ x: 0, y: pts[0]!.y }, ...pts, { x: 1, y: pts[pts.length - 1]!.y }]
})
const line = computed(() => held.value.map((p) => `${p.x * W},${py(p.y)}`).join(' '))
const area = computed(() => `0,${H} ${line.value} ${W},${H}`)

/** The pointer as a curve point, from the box's own size (scale-proof). */
function at(e: MouseEvent): CurvePoint {
  const r = svg.value!.getBoundingClientRect()
  const fx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
  const fy = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
  const y = props.min + (1 - fy) * (props.max - props.min)
  return { x: Math.round(fx * 100) / 100, y: Math.round(y * 100) / 100 }
}
function add(e: MouseEvent) {
  model.value = [...model.value, at(e)].sort((a, b) => a.x - b.x)
}
function remove(i: number) {
  model.value = model.value.filter((_, j) => j !== i)
}
function drag(e: PointerEvent, i: number) {
  if (e.button !== 0) return
  const dot = e.currentTarget as HTMLElement
  dot.setPointerCapture(e.pointerId)
  const move = (m: PointerEvent) => {
    const pts = model.value.map((p) => ({ ...p }))
    const p = at(m)
    p.x = Math.min(pts[i + 1]?.x ?? 1, Math.max(pts[i - 1]?.x ?? 0, p.x))
    pts[i] = p
    model.value = pts
  }
  const up = () => {
    dot.removeEventListener('pointermove', move)
    dot.removeEventListener('pointerup', up)
  }
  dot.addEventListener('pointermove', move)
  dot.addEventListener('pointerup', up)
}
</script>

<style scoped>
.zce {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.zce-box {
  position: relative;
  height: 80px;
  border: 1px solid var(--zen-border, #34343c);
  border-radius: var(--zen-radius, 7px);
  background: var(--zen-field-bg, var(--zen-input, #1b1b20));
}
.zce-svg {
  display: block;
  width: 100%;
  height: 100%;
  cursor: crosshair;
}
.zce-grid {
  stroke: color-mix(in srgb, var(--zen-text, #e5e5ea) 7%, transparent);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}
.zce-unit {
  stroke: color-mix(in srgb, var(--zen-text, #e5e5ea) 25%, transparent);
  stroke-dasharray: 3 3;
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}
.zce-area {
  fill: color-mix(in srgb, var(--zen-accent, #6366f1) 16%, transparent);
}
.zce-line {
  fill: none;
  stroke: var(--zen-accent, #6366f1);
  stroke-width: 1.8;
  vector-effect: non-scaling-stroke;
}
.zce-pt {
  position: absolute;
  width: 10px;
  height: 10px;
  margin: -5px 0 0 -5px;
  border: 2px solid var(--zen-accent, #6366f1);
  border-radius: 50%;
  background: var(--zen-bg, #1a1a1f);
  cursor: grab;
  touch-action: none;
}
.zce-pt:hover {
  background: var(--zen-accent, #6366f1);
}
.zce-axis {
  display: flex;
  justify-content: space-between;
  color: var(--zen-muted, #9aa0aa);
  font-size: 10px;
}
.zce-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.zce-preset {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  border: 1px solid var(--zen-border, #34343c);
  border-radius: var(--zen-radius, 7px);
  background: none;
  color: var(--zen-muted, #9aa0aa);
  font: inherit;
  font-size: 10.5px;
  cursor: pointer;
}
.zce-preset:hover {
  border-color: var(--zen-accent, #6366f1);
  color: var(--zen-text, #e5e5ea);
}
</style>
