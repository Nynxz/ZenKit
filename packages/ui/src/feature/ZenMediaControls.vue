<template>
  <div
    ref="root"
    class="zmc"
    :class="{ compact: size !== 'full', tiny: size === 'tiny' }"
    @pointerdown.stop
    @dblclick.stop
  >
    <button
      type="button"
      class="zmc-b"
      :title="paused ? 'Play (Space)' : 'Pause (Space)'"
      @click="toggle"
    >
      <i class="mdi" :class="paused ? 'mdi-play' : 'mdi-pause'" />
    </button>
    <button
      v-if="isVideo && size === 'full'"
      type="button"
      class="zmc-b"
      title="Previous frame (,)"
      @click="step(-1)"
    >
      <i class="mdi mdi-skip-previous-outline" />
    </button>
    <button
      v-if="isVideo && size === 'full'"
      type="button"
      class="zmc-b"
      title="Next frame (.)"
      @click="step(1)"
    >
      <i class="mdi mdi-skip-next-outline" />
    </button>
    <span class="zmc-time">{{ fmt(current) }}</span>

    <div
      ref="bar"
      class="zmc-bar"
      @pointerdown="startScrub"
      @pointermove="onHover"
      @pointerleave="hoverAt = null"
    >
      <div class="zmc-track">
        <div
          v-for="(r, i) in buffered"
          :key="i"
          class="zmc-buf"
          :style="{ left: pct(r[0]), width: pct(r[1] - r[0]) }"
        />
        <div class="zmc-fill" :style="{ width: pct(current) }" />
      </div>
      <div class="zmc-knob" :style="{ left: pct(current) }" />
      <span v-if="hoverAt !== null" class="zmc-tip" :style="{ left: pct(hoverAt) }">
        {{ fmt(hoverAt) }}
      </span>
    </div>

    <span v-if="size !== 'tiny'" class="zmc-time soft">{{ fmt(duration) }}</span>
    <button
      v-if="size !== 'tiny'"
      type="button"
      class="zmc-b"
      :class="{ on: looping && !noLoop }"
      :disabled="noLoop"
      :title="noLoop ? 'Plays to the end (slideshow)' : looping ? 'Looping' : 'Loop'"
      @click="setLoop(!looping)"
    >
      <i class="mdi mdi-repeat" />
    </button>
    <button
      v-if="size === 'full'"
      type="button"
      class="zmc-b zmc-rate"
      title="Playback speed"
      @click="cycleRate"
    >
      {{ rate }}×
    </button>
    <ZenVolume v-model:volume="volume" v-model:muted="muted" :show-value="size === 'full'" />
  </div>
</template>

<script setup lang="ts">
// ZenMediaControls — a themed control bar for a <video> or <audio> element the host renders: play,
// frame stepping, a scrubber (buffered range, hover time, drag to seek), loop, speed and volume.
// It drives the element rather than owning it, so the host keeps the element wherever its own
// layout needs it (a zoomed and panned stage, a compare split) and the controls stay outside that
// transform — full size, and never in the way of a pan.
//
// Keys, while the pointer is over the host or it has focus, through `onKey` (the host forwards
// them): Space / K play, J / L ∓5 s, , / . a frame, M mute. Arrows are left to the host (the
// lightbox pages with them).
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import ZenVolume from '../inputs/ZenVolume.vue'

const props = withDefaults(
  defineProps<{
    media: HTMLMediaElement | null
    /** For frame stepping; clips don't say their own frame rate. */
    fps?: number
    compact?: boolean
    /** Play once whatever the loop button says — e.g. while a slideshow waits for the end. */
    noLoop?: boolean
  }>(),
  { fps: 24, compact: false },
)

const RATES = [0.25, 0.5, 1, 1.5, 2]
const VOLUME_KEY = 'zenkit.media.volume'

const paused = ref(true)
const current = ref(0)
const duration = ref(0)
const buffered = ref<[number, number][]>([])
const looping = ref(true)
const rate = ref(1)
const volume = ref(1)
const muted = ref(false)
const hoverAt = ref<number | null>(null)
const bar = ref<HTMLElement | null>(null)
const isVideo = computed(() => props.media instanceof HTMLVideoElement)

// The bar fits its own width: below ~420px it drops frame stepping and speed, below ~300px the
// duration, loop and volume slider too (mute stays), so nothing is ever cut off.
const root = ref<HTMLElement | null>(null)
const width = ref(Infinity)
const size = computed(() =>
  width.value < 300 ? 'tiny' : props.compact || width.value < 420 ? 'compact' : 'full',
)
let sizer: ResizeObserver | null = null
onMounted(() => {
  if (!root.value) return
  sizer = new ResizeObserver(() => (width.value = root.value?.clientWidth ?? Infinity))
  sizer.observe(root.value)
})
onBeforeUnmount(() => sizer?.disconnect())

try {
  const saved = JSON.parse(localStorage.getItem(VOLUME_KEY) ?? 'null') as {
    v: number
    m: boolean
  } | null
  if (saved) [volume.value, muted.value] = [saved.v, saved.m]
} catch {
  // a remembered volume is a convenience
}

let frame = 0
function sync() {
  const m = props.media
  if (!m) return
  paused.value = m.paused
  current.value = m.currentTime
  duration.value = Number.isFinite(m.duration) ? m.duration : 0
  const ranges: [number, number][] = []
  for (let i = 0; i < m.buffered.length; i++) ranges.push([m.buffered.start(i), m.buffered.end(i)])
  buffered.value = ranges
}
/** While playing, follow the clock every frame: `timeupdate` only fires ~4× a second, which makes
 *  the knob stutter. */
function follow() {
  sync()
  frame = props.media && !props.media.paused ? requestAnimationFrame(follow) : 0
}
const EVENTS = [
  'play',
  'pause',
  'seeked',
  'timeupdate',
  'durationchange',
  'loadedmetadata',
  'progress',
  'ratechange',
]
function onEvent(e: Event) {
  sync()
  if (e.type === 'play' && !frame) frame = requestAnimationFrame(follow)
}

watch(
  () => props.media,
  (m, old) => {
    for (const ev of EVENTS) old?.removeEventListener(ev, onEvent)
    cancelAnimationFrame(frame)
    frame = 0
    if (!m) return
    for (const ev of EVENTS) m.addEventListener(ev, onEvent)
    m.loop = looping.value && !props.noLoop
    m.playbackRate = rate.value
    m.volume = volume.value
    m.muted = muted.value
    sync()
    if (!m.paused) frame = requestAnimationFrame(follow)
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  for (const ev of EVENTS) props.media?.removeEventListener(ev, onEvent)
  cancelAnimationFrame(frame)
})

function toggle() {
  const m = props.media
  if (!m) return
  if (m.paused) void m.play().catch(() => {})
  else m.pause()
}
function seek(t: number) {
  const m = props.media
  if (!m || !duration.value) return
  m.currentTime = Math.min(Math.max(t, 0), duration.value)
  current.value = m.currentTime
}
function step(frames: number) {
  props.media?.pause()
  seek(current.value + frames / props.fps)
}
function setLoop(on: boolean) {
  looping.value = on
  const m = props.media
  if (m) m.loop = on && !props.noLoop
}
watch(
  () => props.noLoop,
  () => setLoop(looping.value),
)
function cycleRate() {
  rate.value = RATES[(RATES.indexOf(rate.value) + 1) % RATES.length]!
  const m = props.media
  if (m) m.playbackRate = rate.value
}
function remember() {
  try {
    localStorage.setItem(VOLUME_KEY, JSON.stringify({ v: volume.value, m: muted.value }))
  } catch {
    // a remembered volume is a convenience
  }
}
/** Keep the element on the chosen level, and remember it for next time. */
watch([volume, muted], () => {
  const m = props.media
  if (m) [m.volume, m.muted] = [volume.value, muted.value]
  remember()
})
function toggleMute() {
  muted.value = !muted.value
  if (!muted.value && volume.value === 0) volume.value = 0.6
}

const timeAt = (clientX: number) => {
  const r = bar.value!.getBoundingClientRect()
  return (Math.min(Math.max(clientX - r.left, 0), r.width) / r.width) * duration.value
}
function onHover(e: PointerEvent) {
  if (duration.value) hoverAt.value = timeAt(e.clientX)
}
/** Drag anywhere on the bar to scrub; playback pauses while you do and resumes after. */
function startScrub(e: PointerEvent) {
  if (e.button !== 0 || !props.media || !duration.value) return
  e.preventDefault()
  ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  const wasPlaying = !props.media.paused
  props.media.pause()
  seek(timeAt(e.clientX))
  const move = (m: PointerEvent) => {
    seek(timeAt(m.clientX))
    hoverAt.value = timeAt(m.clientX)
  }
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    if (wasPlaying) void props.media?.play().catch(() => {})
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

const pct = (t: number) => `${duration.value ? (t / duration.value) * 100 : 0}%`
function fmt(t: number) {
  if (!Number.isFinite(t)) return '0:00'
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  const f = Math.floor((t % 1) * props.fps)
  return isVideo.value && size.value === 'full'
    ? `${m}:${String(s).padStart(2, '0')}.${String(f).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}

/** Handle a key; true when it was a media key (the host should then stop it). */
function onKey(e: KeyboardEvent): boolean {
  if (!props.media) return false
  switch (e.key) {
    case ' ':
    case 'k':
      toggle()
      return true
    case 'j':
      seek(current.value - 5)
      return true
    case 'l':
      seek(current.value + 5)
      return true
    case ',':
      step(-1)
      return true
    case '.':
      step(1)
      return true
    case 'm':
      toggleMute()
      return true
    default:
      return false
  }
}
defineExpose({ onKey, toggle, seek })
</script>

<style scoped>
.zmc {
  display: flex;
  box-sizing: border-box;
  min-width: 0;
  align-items: center;
  gap: 4px;
  padding: 5px 8px;
  border: 1px solid var(--zen-surface-border, var(--zen-border, #34343c));
  border-radius: var(--zen-radius-surface, var(--zen-radius, 7px));
  background: color-mix(in srgb, var(--zen-surface, #202026) 88%, transparent);
  backdrop-filter: blur(10px);
  color: var(--zen-text, #e5e5ea);
  font-size: 11px;
  user-select: none;
}
.zmc-b {
  display: inline-grid;
  flex: none;
  place-items: center;
  min-width: 26px;
  height: 26px;
  padding: 0 4px;
  border: 0;
  border-radius: var(--zen-radius, 7px);
  background: none;
  color: var(--zen-muted, #9aa0aa);
  font: inherit;
  cursor: pointer;
}
.zmc-b:hover,
.zmc-b.on {
  background: color-mix(in srgb, var(--zen-text, #e5e5ea) 10%, transparent);
  color: var(--zen-text, #e5e5ea);
}
.zmc-b.on {
  color: var(--zen-accent, #6366f1);
}
.zmc-b:disabled {
  opacity: 0.4;
  cursor: default;
}
.zmc-b .mdi {
  font-size: 17px;
}
.zmc-rate {
  min-width: 38px;
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.zmc-time {
  flex: none;
  min-width: 44px;
  font-variant-numeric: tabular-nums;
  text-align: center;
}
.zmc-time.soft {
  color: var(--zen-muted, #9aa0aa);
}
.zmc-bar {
  position: relative;
  flex: 1;
  min-width: 60px;
  height: 22px;
  cursor: pointer;
  touch-action: none;
}
.zmc-track {
  position: absolute;
  top: 50%;
  right: 0;
  left: 0;
  height: 4px;
  overflow: hidden;
  border-radius: 2px;
  background: color-mix(in srgb, var(--zen-text, #e5e5ea) 14%, transparent);
  transform: translateY(-50%);
  transition: height 0.1s;
}
.zmc-bar:hover .zmc-track {
  height: 6px;
}
.zmc-buf {
  position: absolute;
  top: 0;
  bottom: 0;
  background: color-mix(in srgb, var(--zen-text, #e5e5ea) 16%, transparent);
}
.zmc-fill {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  background: var(--zen-accent, #6366f1);
}
.zmc-knob {
  position: absolute;
  top: 50%;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--zen-text, #e5e5ea);
  box-shadow: 0 1px 4px rgb(0 0 0 / 50%);
  transform: translate(-50%, -50%) scale(0);
  transition: transform 0.1s;
}
.zmc-bar:hover .zmc-knob {
  transform: translate(-50%, -50%) scale(1);
}
.zmc-tip {
  position: absolute;
  bottom: 100%;
  margin-bottom: 4px;
  padding: 2px 5px;
  border-radius: 4px;
  background: rgb(0 0 0 / 80%);
  color: #fff;
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  transform: translateX(-50%);
  pointer-events: none;
}
.zmc.compact .zmc-time {
  min-width: 34px;
}
.zmc.compact .zmc-bar {
  min-width: 40px;
}
.zmc.tiny {
  gap: 2px;
  padding: 4px 5px;
}
.zmc.tiny :deep(.zvol-track) {
  display: none;
}
</style>
