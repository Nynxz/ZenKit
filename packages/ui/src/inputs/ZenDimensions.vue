<script setup lang="ts">
// ZenDimensions — width × height as ONE compact control (v-model over {width,height}), so a
// node declares one input instead of separate width + height. Renders a single inline row:
//   1024 × 1024
// Aspect-lock, swap, an editable MP field and an aspect readout are all opt-in (off by
// default) so the control stays small. Snap + clamp are applied on every edit.
import { computed, ref, watch } from 'vue'
import ZenNumber from './ZenNumber.vue'
import ZenIconButton from '../primitives/ZenIconButton.vue'
import {
  aspectRatio,
  clampDimension,
  megapixels,
  scaleToMegapixels,
  snap,
  MAX_DIMENSION,
  MIN_DIMENSION,
  type DimensionsValue,
} from '../lib/dimensions'

const props = withDefaults(
  defineProps<{
    modelValue: DimensionsValue
    min?: number
    max?: number
    /** Snap step for W/H (and MP-scaled results). */
    step?: number
    lockAspect?: boolean
    showLock?: boolean
    showSwap?: boolean
    showMp?: boolean
    showAspect?: boolean
  }>(),
  {
    min: MIN_DIMENSION,
    max: MAX_DIMENSION,
    step: 8,
    lockAspect: false,
    showLock: true,
    showSwap: false,
    showMp: false,
    showAspect: false,
  },
)
const emit = defineEmits<{
  'update:modelValue': [DimensionsValue]
  'update:lockAspect': [boolean]
}>()

const w = computed(() => clampDimension(props.modelValue?.width ?? 1024, props.min, props.max))
const h = computed(() => clampDimension(props.modelValue?.height ?? 1024, props.min, props.max))
const ratio = computed(() => aspectRatio(w.value, h.value))
const mpNum = computed(() => Number(megapixels(w.value, h.value).toFixed(2)))

// Ratio held while aspect-lock is on. Captured on lock-enable / external change so field
// edits keep a clean ratio instead of drifting on repeated snaps; our own lock-preserving
// edits skip the re-baseline.
const lockedRatio = ref(w.value / Math.max(1, h.value))
let selfEdit = false
function baseline() {
  lockedRatio.value = w.value / Math.max(1, h.value)
}
watch(
  () => [props.modelValue?.width, props.modelValue?.height],
  () => {
    if (selfEdit) {
      selfEdit = false
      return
    }
    baseline()
  },
)
watch(
  () => props.lockAspect,
  (on) => {
    if (on) baseline()
  },
)

function commit(nw: number, nh: number, keepRatio: boolean) {
  selfEdit = keepRatio
  emit('update:modelValue', {
    width: clampDimension(snap(nw, props.step), props.min, props.max),
    height: clampDimension(snap(nh, props.step), props.min, props.max),
  })
}
function setW(v: number) {
  const nw = clampDimension(snap(v, props.step), props.min, props.max)
  commit(nw, props.lockAspect ? nw / (lockedRatio.value || 1) : h.value, props.lockAspect)
}
function setH(v: number) {
  const nh = clampDimension(snap(v, props.step), props.min, props.max)
  commit(props.lockAspect ? nh * (lockedRatio.value || 1) : w.value, nh, props.lockAspect)
}
function scaleToMp(target: number) {
  if (!Number.isFinite(target) || target <= 0) return
  const r = scaleToMegapixels(w.value, h.value, target, props.step)
  commit(r.width, r.height, true) // MP scaling preserves aspect → no re-baseline
}
function swap() {
  commit(h.value, w.value, false)
}
function toggleLock() {
  emit('update:lockAspect', !props.lockAspect)
}
</script>

<template>
  <div class="zen-dims">
    <ZenNumber
      bare
      class="zd-n"
      :model-value="w"
      :min="min"
      :max="max"
      :step="step"
      :precision="0"
      title="Width"
      @update:model-value="setW"
    />
    <span class="zd-x">×</span>
    <ZenNumber
      bare
      class="zd-n"
      :model-value="h"
      :min="min"
      :max="max"
      :step="step"
      :precision="0"
      title="Height"
      @update:model-value="setH"
    />
    <ZenIconButton
      v-if="showLock"
      :active="lockAspect"
      :icon="lockAspect ? 'mdi mdi-link-variant' : 'mdi mdi-link-variant-off'"
      title="Lock aspect ratio"
      @click="toggleLock"
    />
    <ZenIconButton
      v-if="showSwap"
      icon="mdi mdi-swap-horizontal"
      title="Swap width / height"
      @click="swap"
    />
    <template v-if="showMp">
      <ZenNumber
        bare
        class="zd-mp"
        :model-value="mpNum"
        :min="0.1"
        :max="64"
        :step="0.25"
        :precision="2"
        title="Megapixels — scales W/H, keeps aspect"
        @update:model-value="scaleToMp"
      />
      <span class="zd-unit">MP</span>
    </template>
    <span v-if="showAspect" class="zd-aspect" title="Aspect ratio">{{ ratio }}</span>
  </div>
</template>

<style scoped>
/* one inline row; wraps only if the node gets very narrow */
.zen-dims {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px;
}
.zd-n {
  flex: 1 1 60px;
  min-width: 48px;
}
.zd-x {
  flex: none;
  color: var(--zen-muted, #9aa0aa);
  font-size: 11px;
}
.zd-mp {
  flex: 0 1 56px;
  min-width: 44px;
}
.zd-unit,
.zd-aspect {
  flex: none;
  font-size: 10px;
  color: var(--zen-muted, #9aa0aa);
  font-variant-numeric: tabular-nums;
}
.zd-aspect {
  margin-left: auto;
}
</style>
