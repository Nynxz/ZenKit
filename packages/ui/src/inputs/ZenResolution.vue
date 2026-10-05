<template>
  <div class="zres">
    <div class="zres-sec">aspect ratio</div>
    <div class="zres-aspects">
      <button
        v-for="r in ratios"
        :key="r.label"
        type="button"
        class="zres-chip"
        :class="{ on: ratio === r.label }"
        :title="r.label"
        @click="setRatio(r)"
      >
        <span class="zres-rect" :style="rectStyle(r)" />
        <span>{{ r.label }}</span>
      </button>
    </div>
    <ZenToggleGroup
      v-if="ratio !== '1:1'"
      class="zres-wide"
      :model-value="portrait ? 'portrait' : 'landscape'"
      :options="[
        { value: 'landscape', label: 'Landscape', icon: 'mdi mdi-crop-landscape' },
        { value: 'portrait', label: 'Portrait', icon: 'mdi mdi-crop-portrait' },
      ]"
      @update:model-value="(v: string) => setOrientation(v === 'portrait')"
    />
    <div class="zres-div" />
    <div class="zres-row">
      <span class="zres-lbl">megapixels</span>
      <ZenNumber
        :model-value="Math.round(mp * 100) / 100"
        :min="0.1"
        :max="maxMp"
        :step="0.05"
        :precision="2"
        @update:model-value="setMp"
      />
    </div>
    <ZenToggleGroup
      class="zres-wide"
      :model-value="sizePreset"
      :options="presetOptions"
      @update:model-value="setPreset"
    />
    <div class="zres-div" />
    <div class="zres-wh">
      <label>
        <span>W</span>
        <ZenNumber
          :model-value="width"
          :min="snap"
          :max="maxSide"
          :step="snap"
          :precision="0"
          @update:model-value="(v: number) => commit({ width: v, height })"
        />
      </label>
      <ZenIconButton
        icon="mdi mdi-swap-horizontal"
        title="Swap width and height"
        @click="commit({ width: height, height: width })"
      />
      <label>
        <span>H</span>
        <ZenNumber
          :model-value="height"
          :min="snap"
          :max="maxSide"
          :step="snap"
          :precision="0"
          @update:model-value="(v: number) => commit({ width, height: v })"
        />
      </label>
    </div>
    <div class="zres-foot">
      <span>{{ mp.toFixed(2) }} MP · {{ shape }}</span>
      <span class="zres-grow" />
      <span>snaps to {{ snap }} px</span>
    </div>
  </div>
</template>

<script setup lang="ts">
// ZenResolution — pick a width × height by aspect ratio and size, or type it exactly. Every value
// snaps to `snap`. Sizes are computed, never nudged: a ratio at a size always gives the same
// pixels, so switching aspect keeps the size you chose and clicking what is lit changes nothing.
import { computed } from 'vue'

import ZenIconButton from '../primitives/ZenIconButton.vue'
import ZenNumber from './ZenNumber.vue'
import ZenToggleGroup from './ZenToggleGroup.vue'

export interface ResolutionRatio {
  label: string
  w: number
  h: number
}
type Size = { width: number; height: number }

const props = withDefaults(
  defineProps<{
    width: number
    height: number
    snap?: number
    /** Megapixel sizes offered as one-click presets. */
    presets?: number[]
    ratios?: ResolutionRatio[]
    /** The model's own size for a ratio (width / height); shown first as the "Native" preset. */
    native?: (ratio: number) => Size
    maxSide?: number
    maxMp?: number
  }>(),
  {
    snap: 32,
    presets: () => [0.5, 1, 1.5, 2],
    ratios: () => [
      { label: '1:1', w: 1, h: 1 },
      { label: '4:3', w: 4, h: 3 },
      { label: '3:2', w: 3, h: 2 },
      { label: '16:9', w: 16, h: 9 },
      { label: '21:9', w: 21, h: 9 },
    ],
    native: undefined,
    maxSide: 4096,
    maxMp: 16,
  },
)
const emit = defineEmits<{ 'update:width': [number]; 'update:height': [number] }>()

const snapTo = (v: number) =>
  Math.min(props.maxSide, Math.max(props.snap, Math.round(v / props.snap) * props.snap))
const portrait = computed(() => props.height > props.width)
const mp = computed(() => (props.width * props.height) / 1e6)
const oriented = (r: ResolutionRatio) => (portrait.value && r.w !== r.h ? r.h / r.w : r.w / r.h)

/** The snapped size closest to `ratio` at `megapixels`: tries every snapped width near the ideal
 *  and keeps the one whose shape and area both land nearest. */
function fit(ratio: number, megapixels: number): Size {
  const area = megapixels * 1e6
  const ideal = Math.sqrt(area * ratio)
  let best: Size = { width: snapTo(ideal), height: snapTo(ideal / ratio) }
  let bestScore = Infinity
  for (let k = -3; k <= 3; k++) {
    const width = snapTo(ideal + k * props.snap)
    const height = snapTo(width / ratio)
    const score =
      3 * Math.abs(Math.log(width / height / ratio)) + Math.abs(Math.log((width * height) / area))
    if (score < bestScore) [best, bestScore] = [{ width, height }, score]
  }
  return best
}
const same = (a: Size) => a.width === props.width && a.height === props.height
function nativeSize(ratio: number): Size {
  const n = props.native!(ratio)
  return { width: snapTo(n.width), height: snapTo(n.height) }
}

/** The listed ratio the current size is (closest to, within a snap's worth). */
const activeRatio = computed(() => {
  const r = Math.max(props.width, props.height) / Math.min(props.width, props.height)
  let best = props.ratios[0]!
  for (const c of props.ratios)
    if (Math.abs(c.w / c.h - r) < Math.abs(best.w / best.h - r)) best = c
  return Math.abs(best.w / best.h - r) < 0.05 ? best : null
})
const ratio = computed(() => activeRatio.value?.label ?? '')
const shapeNow = computed(() =>
  activeRatio.value ? oriented(activeRatio.value) : props.width / props.height,
)

/** Which size preset the current pixels are exactly ('native', a megapixel count, or ''). */
const sizePreset = computed(() => {
  if (props.native && same(nativeSize(shapeNow.value))) return 'native'
  const hit = props.presets.find((p) => same(fit(shapeNow.value, p)))
  return hit === undefined ? '' : String(hit)
})

function commit(size: Size) {
  emit('update:width', snapTo(size.width))
  emit('update:height', snapTo(size.height))
}
function sized(shape: number, preset: string, megapixels = mp.value): Size {
  if (preset === 'native' && props.native) return nativeSize(shape)
  return fit(shape, preset ? Number(preset) : megapixels)
}
function setRatio(r: ResolutionRatio) {
  commit(sized(oriented(r), sizePreset.value))
}
function setOrientation(toPortrait: boolean) {
  if (toPortrait !== portrait.value) commit({ width: props.height, height: props.width })
}
function setPreset(preset: string) {
  commit(sized(shapeNow.value, preset))
}
function setMp(value: number) {
  commit(fit(shapeNow.value, Math.min(Math.max(value, 0.05), props.maxMp)))
}

const presetOptions = computed(() => [
  ...(props.native
    ? [{ value: 'native', label: 'Native', title: "The model's own size for this shape" }]
    : []),
  ...props.presets.map((p) => ({ value: String(p), label: String(p), title: `${p} megapixels` })),
])

function rectStyle(r: ResolutionRatio) {
  const [w, h] = portrait.value && r.w !== r.h ? [r.h, r.w] : [r.w, r.h]
  const s = 20 / Math.max(w, h)
  return { width: `${Math.round(w * s)}px`, height: `${Math.round(h * s)}px` }
}
const shape = computed(() => {
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)
  const g = gcd(props.width, props.height)
  const [a, b] = [props.width / g, props.height / g]
  if (a <= 21 && b <= 21) return `${a}:${b}`
  const near = activeRatio.value
  if (!near) return `${(props.width / props.height).toFixed(2)}:1`
  return portrait.value && near.w !== near.h ? `≈ ${near.h}:${near.w}` : `≈ ${near.label}`
})
</script>

<style scoped>
.zres {
  display: flex;
  flex-direction: column;
  gap: 9px;
  width: 268px;
  padding: 6px;
  color: var(--zen-text, #e5e5ea);
  font-size: 11px;
}
.zres-sec {
  color: var(--zen-muted, #9aa0aa);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.zres-aspects {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 5px;
}
.zres-chip {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 46px;
  border: 1px solid var(--zen-border, #34343c);
  border-radius: var(--zen-radius, 7px);
  background: var(--zen-field-bg, var(--zen-input, #1b1b20));
  color: var(--zen-muted, #9aa0aa);
  font: inherit;
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
}
.zres-chip:hover,
.zres-chip.on {
  border-color: var(--zen-accent, #6366f1);
  color: var(--zen-text, #e5e5ea);
}
.zres-chip.on {
  background: color-mix(
    in srgb,
    var(--zen-accent, #6366f1) 16%,
    var(--zen-field-bg, var(--zen-input, #1b1b20))
  );
}
.zres-rect {
  display: block;
  border-radius: 1px;
  background: currentColor;
  opacity: 0.7;
}
.zres-wide :deep(.zen-tg) {
  display: flex;
  width: 100%;
}
.zres-wide :deep(.zen-tg-b) {
  flex: 1;
}
.zres-div {
  border-top: 1px solid var(--zen-border, #34343c);
}
.zres-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.zres-lbl {
  flex: 1;
  color: var(--zen-muted, #9aa0aa);
}
.zres-wh {
  display: flex;
  align-items: center;
  gap: 6px;
}
.zres-wh label {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 5px;
  color: var(--zen-muted, #9aa0aa);
}
.zres-wh label :deep(.zen-num) {
  flex: 1;
  min-width: 0;
}
.zres-foot {
  display: flex;
  align-items: center;
  color: var(--zen-muted, #9aa0aa);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
.zres-grow {
  flex: 1;
}
</style>
