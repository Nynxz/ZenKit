<template>
  <div
    class="zvol"
    :class="{ off: muted || volume === 0, quiet: disabled }"
    :title="title"
    @wheel.prevent="onWheel"
  >
    <button
      type="button"
      class="zvol-b"
      :aria-label="muted ? 'Unmute' : 'Mute'"
      @click="toggleMute"
    >
      <i class="mdi" :class="icon" />
    </button>
    <div ref="track" class="zvol-track" @pointerdown="startDrag">
      <div class="zvol-fill" :style="{ width: `${shown * 100}%` }" />
      <div class="zvol-knob" :style="{ left: `${shown * 100}%` }" />
    </div>
    <span v-if="showValue" class="zvol-n">{{ Math.round(shown * 100) }}</span>
  </div>
</template>

<script setup lang="ts">
// ZenVolume — a volume control: a speaker that mutes (and unmutes back to the level you had), a
// slider you drag or click, and the scroll wheel anywhere on it for fine steps. `disabled` only
// dims it (say, when nothing playing has sound) — the level can still be set ahead of time.
import { computed, ref } from 'vue'

const volume = defineModel<number>('volume', { default: 1 })
const muted = defineModel<boolean>('muted', { default: false })
const props = withDefaults(
  defineProps<{ disabled?: boolean; disabledTitle?: string; showValue?: boolean }>(),
  { disabled: false, disabledTitle: 'Nothing playing has sound', showValue: true },
)

const track = ref<HTMLElement | null>(null)
const shown = computed(() => (muted.value ? 0 : volume.value))
const icon = computed(() =>
  shown.value === 0
    ? 'mdi-volume-off'
    : shown.value < 0.34
      ? 'mdi-volume-low'
      : shown.value < 0.67
        ? 'mdi-volume-medium'
        : 'mdi-volume-high',
)
const title = computed(() =>
  props.disabled
    ? props.disabledTitle
    : `Volume ${Math.round(shown.value * 100)}% — scroll to adjust, click the speaker to mute`,
)

function set(v: number) {
  const next = Math.round(Math.min(1, Math.max(0, v)) * 100) / 100
  volume.value = next
  muted.value = next === 0
}
function toggleMute() {
  if (muted.value || volume.value === 0) {
    muted.value = false
    if (volume.value === 0) volume.value = 0.6
  } else muted.value = true
}
function onWheel(e: WheelEvent) {
  set(shown.value + (e.deltaY < 0 ? 0.05 : -0.05))
}
function at(clientX: number) {
  const r = track.value!.getBoundingClientRect()
  return (clientX - r.left) / Math.max(1, r.width)
}
function startDrag(e: PointerEvent) {
  if (e.button !== 0) return
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  set(at(e.clientX))
  const move = (m: PointerEvent) => set(at(m.clientX))
  const up = () => {
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', up)
  }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up)
}
</script>

<style scoped>
.zvol {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 8px 0 2px;
  color: var(--zen-text, #e5e5ea);
  font-size: 10.5px;
  user-select: none;
}
.zvol.quiet {
  opacity: 0.45;
}
.zvol-b {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: var(--zen-radius, 7px);
  background: none;
  color: inherit;
  cursor: pointer;
}
.zvol-b:hover {
  background: color-mix(in srgb, var(--zen-text, #e5e5ea) 10%, transparent);
}
.zvol-b .mdi {
  font-size: 17px;
}
.zvol.off .zvol-b {
  color: var(--zen-muted, #9aa0aa);
}
.zvol-track {
  position: relative;
  width: 72px;
  height: 18px;
  cursor: pointer;
  touch-action: none;
}
.zvol-track::before {
  position: absolute;
  top: 50%;
  right: 0;
  left: 0;
  height: 4px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--zen-text, #e5e5ea) 16%, transparent);
  transform: translateY(-50%);
  content: '';
}
.zvol-fill {
  position: absolute;
  top: 50%;
  left: 0;
  height: 4px;
  border-radius: 2px;
  background: var(--zen-accent, #6366f1);
  transform: translateY(-50%);
}
.zvol-knob {
  position: absolute;
  top: 50%;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: var(--zen-text, #e5e5ea);
  box-shadow: 0 1px 3px rgb(0 0 0 / 45%);
  transform: translate(-50%, -50%);
}
.zvol-n {
  min-width: 20px;
  color: var(--zen-muted, #9aa0aa);
  font-variant-numeric: tabular-nums;
  text-align: right;
}
</style>
