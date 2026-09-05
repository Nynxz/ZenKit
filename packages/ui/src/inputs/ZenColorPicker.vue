<script setup lang="ts">
// ZenColorPicker — a compact, themed colour control: a swatch trigger that opens a popover
// (saturation/brightness box + hue slider + hex field + presets). No native OS dialog, so it
// stays consistent with the rest of the UI. v-model is a `#rrggbb` string.
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = withDefaults(defineProps<{ modelValue: string; presets?: string[] }>(), {
  presets: () => ['#ff3b30', '#ffcc00', '#34c759', '#0a84ff', '#ffffff', '#000000'],
})
const emit = defineEmits<{ 'update:modelValue': [string] }>()

const open = ref(false)
const trigger = ref<HTMLElement | null>(null)
const pop = ref<HTMLElement | null>(null)
const popStyle = ref<Record<string, string>>({})

const h = ref(0)
const s = ref(1)
const v = ref(1)
const clamp01 = (x: number) => Math.max(0, Math.min(1, x))

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '')
  return [
    parseInt(m.slice(0, 2), 16) || 0,
    parseInt(m.slice(2, 4), 16) || 0,
    parseInt(m.slice(4, 6), 16) || 0,
  ]
}
function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.round(n).toString(16).padStart(2, '0')
  return '#' + c(r) + c(g) + c(b)
}
function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  const d = mx - mn
  let hh = 0
  if (d) {
    if (mx === r) hh = ((g - b) / d) % 6
    else if (mx === g) hh = (b - r) / d + 2
    else hh = (r - g) / d + 4
    hh *= 60
    if (hh < 0) hh += 360
  }
  return [hh, mx ? d / mx : 0, mx]
}
function hsvToRgb(hh: number, ss: number, vv: number): [number, number, number] {
  const c = vv * ss
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1))
  const m = vv - c
  let r = 0
  let g = 0
  let b = 0
  if (hh < 60) {
    r = c
    g = x
  } else if (hh < 120) {
    r = x
    g = c
  } else if (hh < 180) {
    g = c
    b = x
  } else if (hh < 240) {
    g = x
    b = c
  } else if (hh < 300) {
    r = x
    b = c
  } else {
    r = c
    b = x
  }
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255]
}
const hex = computed(() => {
  const [r, g, b] = hsvToRgb(h.value, s.value, v.value)
  return rgbToHex(r, g, b)
})
const hueColor = computed(() => {
  const [r, g, b] = hsvToRgb(h.value, 1, 1)
  return rgbToHex(r, g, b)
})

function syncFromModel() {
  const [r, g, b] = hexToRgb(props.modelValue || '#000000')
  const [hh, ss, vv] = rgbToHsv(r, g, b)
  h.value = hh
  s.value = ss
  v.value = vv
}
watch(
  () => props.modelValue,
  (nv) => {
    if (nv && nv.toLowerCase() !== hex.value.toLowerCase()) syncFromModel()
  },
)
function emitColor() {
  emit('update:modelValue', hex.value)
}

function svDown(e: PointerEvent) {
  const el = e.currentTarget as HTMLElement
  const move = (m: PointerEvent) => {
    const r = el.getBoundingClientRect()
    s.value = clamp01((m.clientX - r.left) / r.width)
    v.value = clamp01(1 - (m.clientY - r.top) / r.height)
    emitColor()
  }
  move(e)
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}
function hueDown(e: PointerEvent) {
  const el = e.currentTarget as HTMLElement
  const move = (m: PointerEvent) => {
    const r = el.getBoundingClientRect()
    h.value = clamp01((m.clientX - r.left) / r.width) * 360
    emitColor()
  }
  move(e)
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}
function onHex(e: Event) {
  let val = (e.target as HTMLInputElement).value.trim()
  if (!val.startsWith('#')) val = '#' + val
  if (/^#[0-9a-fA-F]{6}$/.test(val)) {
    emit('update:modelValue', val)
    syncFromModel()
  }
}
function pickPreset(c: string) {
  emit('update:modelValue', c)
  syncFromModel()
}

function place() {
  const t = trigger.value?.getBoundingClientRect()
  if (!t) return
  const w = 196
  popStyle.value = {
    left: Math.max(8, Math.min(t.left, window.innerWidth - w - 8)) + 'px',
    top: t.bottom + 6 + 'px',
    width: w + 'px',
  }
}
function onDoc(e: PointerEvent) {
  const t = e.target as Node
  if (trigger.value?.contains(t) || pop.value?.contains(t)) return
  closePop()
}
function toggle() {
  open.value = !open.value
  if (open.value) {
    syncFromModel()
    nextTick(() => {
      place()
      window.addEventListener('pointerdown', onDoc, true)
      window.addEventListener('resize', place)
    })
  } else closePop()
}
function closePop() {
  open.value = false
  window.removeEventListener('pointerdown', onDoc, true)
  window.removeEventListener('resize', place)
}
onBeforeUnmount(closePop)
syncFromModel()
</script>

<template>
  <div class="zcp">
    <button ref="trigger" type="button" class="zcp-trigger" @click="toggle">
      <span class="zcp-sw" :style="{ background: modelValue }" />
      <span class="zcp-hexlbl">{{ modelValue }}</span>
      <i class="mdi mdi-chevron-down" />
    </button>
    <Teleport to="body">
      <div v-if="open" ref="pop" class="zcp-pop" :style="popStyle" @pointerdown.stop>
        <div class="zcp-sv" :style="{ background: hueColor }" @pointerdown="svDown">
          <div class="zcp-sv-white" />
          <div class="zcp-sv-black" />
          <div class="zcp-sv-thumb" :style="{ left: s * 100 + '%', top: (1 - v) * 100 + '%' }" />
        </div>
        <div class="zcp-hue" @pointerdown="hueDown">
          <div class="zcp-hue-thumb" :style="{ left: (h / 360) * 100 + '%' }" />
        </div>
        <div class="zcp-row">
          <span class="zcp-sw lg" :style="{ background: hex }" />
          <input
            class="zcp-input"
            :value="modelValue"
            maxlength="7"
            spellcheck="false"
            @input="onHex"
          />
        </div>
        <div class="zcp-presets">
          <button
            v-for="c in presets"
            :key="c"
            type="button"
            class="zcp-pre"
            :style="{ background: c }"
            :title="c"
            @click="pickPreset(c)"
          />
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* A floor so the control can never collapse to something unusable when it shares a row. It is
   deliberately BELOW the natural content width (~100px): the job here is "never disappear", not
   "always comfortable" — comfort is ZenRow's flex-basis, which can wrap when it doesn't fit,
   whereas a floor can only overflow. The hex label ellipsises below this. `--zen-control-min: 0`
   opts out. */
.zcp {
  display: block;
  width: 100%;
  min-width: var(--zen-control-min, 76px);
}
.zcp-trigger {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 28px;
  box-sizing: border-box;
  padding: 0 6px;
  border: 1px solid var(--zen-border, #34343c);
  border-radius: var(--zen-radius, 6px);
  background: var(--zen-input, #1b1b20);
  color: var(--zen-text, #e5e5ea);
  cursor: pointer;
  font: inherit;
  font-size: 11px;
}
.zcp-trigger:hover {
  border-color: var(--zen-accent, #6366f1);
}
.zcp-sw {
  width: 16px;
  height: 16px;
  flex: none;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.2);
}
.zcp-sw.lg {
  width: 24px;
  height: 24px;
}
/* min-width:0 + ellipsis: without them the hex string is an unbreakable intrinsic floor, so a
   narrow trigger OVERFLOWS its box instead of truncating. */
.zcp-hexlbl {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
  text-transform: uppercase;
  font-variant-numeric: tabular-nums;
}
.zcp-trigger .mdi {
  font-size: 14px;
  color: var(--zen-muted, #9aa0aa);
}
.zcp-pop {
  position: fixed;
  z-index: 100002;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  background: var(--zen-surface, #202026);
  border: 1px solid var(--zen-border, #34343c);
  border-radius: var(--zen-radius, 8px);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
}
.zcp-sv {
  position: relative;
  width: 100%;
  height: 118px;
  border-radius: 6px;
  overflow: hidden;
  cursor: crosshair;
  touch-action: none;
}
.zcp-sv-white,
.zcp-sv-black {
  position: absolute;
  inset: 0;
}
.zcp-sv-white {
  background: linear-gradient(to right, #fff, rgba(255, 255, 255, 0));
}
.zcp-sv-black {
  background: linear-gradient(to top, #000, rgba(0, 0, 0, 0));
}
.zcp-sv-thumb {
  position: absolute;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid #fff;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.5);
  transform: translate(-50%, -50%);
  pointer-events: none;
}
.zcp-hue {
  position: relative;
  width: 100%;
  height: 12px;
  border-radius: 6px;
  cursor: pointer;
  touch-action: none;
  background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
}
.zcp-hue-thumb {
  position: absolute;
  top: 50%;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid #fff;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.5);
  transform: translate(-50%, -50%);
  pointer-events: none;
}
.zcp-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.zcp-input {
  flex: 1;
  min-width: 0;
  height: 26px;
  box-sizing: border-box;
  padding: 0 6px;
  border: 1px solid var(--zen-border, #34343c);
  border-radius: var(--zen-radius, 6px);
  background: var(--zen-input, #1b1b20);
  color: var(--zen-text, #e5e5ea);
  font: inherit;
  font-size: 11px;
  text-transform: uppercase;
}
.zcp-input:focus {
  outline: none;
  border-color: var(--zen-accent, #6366f1);
}
.zcp-presets {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.zcp-pre {
  width: 20px;
  height: 20px;
  padding: 0;
  border-radius: 4px;
  border: 1px solid var(--zen-border, #34343c);
  cursor: pointer;
}
</style>
