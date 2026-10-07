<script setup lang="ts">
// ZenPeek — hold Shift over a thumbnail to see it large: a picture at full size, a video playing,
// audio with a player. Drop one inside the area it should cover; it watches the elements in that
// area that carry `data-peek` (a media URL), with `data-peek-kind` (image | video | audio, else
// guessed from the URL), `data-peek-label` and `data-peek-detail` for the caption. Releasing Shift
// or moving off the thumbnail puts it away.
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import '../lib/surface.css'
import { Z, zAbove } from '../overlays/layers'

type Kind = 'image' | 'video' | 'audio'
interface Shown {
  url: string
  kind: Kind
  label: string
  detail: string
  rect: DOMRect
}

const anchor = ref<HTMLElement | null>(null)
const box = ref<HTMLElement | null>(null)
const shown = ref<Shown | null>(null)
const pos = reactive({ left: 0, top: 0 })
const z = ref<number>(Z.peek)
let hovered: HTMLElement | null = null
let shift = false

const guess = (url: string): Kind =>
  /\.(mp4|webm|mov|mkv|m4v)(\?|$)/i.test(url)
    ? 'video'
    : /\.(wav|mp3|flac|ogg|m4a|aac)(\?|$)/i.test(url)
      ? 'audio'
      : 'image'

function area(): HTMLElement | null {
  return anchor.value?.parentElement ?? null
}

function update() {
  const el = shift ? hovered : null
  const url = el?.dataset.peek
  if (!el || !url) {
    shown.value = null
    return
  }
  if (shown.value?.url === url && shown.value.rect.top === el.getBoundingClientRect().top) return
  shown.value = {
    url,
    kind: (el.dataset.peekKind as Kind) || guess(url),
    label: el.dataset.peekLabel ?? '',
    detail: el.dataset.peekDetail ?? '',
    rect: el.getBoundingClientRect(),
  }
  z.value = zAbove(Z.peek)
  void nextTick(place)
}

/** Beside the thumbnail, on whichever side has room; kept on screen. */
function place() {
  const s = shown.value
  const el = box.value
  if (!s || !el) return
  const w = el.offsetWidth
  const h = el.offsetHeight
  const gap = 12
  const r = s.rect
  const right = window.innerWidth - r.right
  let left = right >= w + gap || right >= r.left ? r.right + gap : r.left - w - gap
  left = Math.min(Math.max(8, left), window.innerWidth - w - 8)
  const top = Math.min(Math.max(8, r.top + r.height / 2 - h / 2), window.innerHeight - h - 8)
  pos.left = left
  pos.top = top
}

function onMove(e: PointerEvent) {
  const root = area()
  const target = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-peek]') : null
  hovered = target && root?.contains(target) ? target : null
  shift = e.shiftKey
  update()
}
function onKey(e: KeyboardEvent) {
  if (e.key !== 'Shift') return
  shift = e.type === 'keydown'
  update()
}
function onBlur() {
  shift = false
  update()
}

onMounted(() => {
  window.addEventListener('pointermove', onMove, { passive: true })
  window.addEventListener('keydown', onKey)
  window.addEventListener('keyup', onKey)
  window.addEventListener('blur', onBlur)
})
onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onMove)
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('keyup', onKey)
  window.removeEventListener('blur', onBlur)
})

const caption = computed(() => shown.value && (shown.value.label || shown.value.detail))
</script>

<template>
  <span ref="anchor" class="zen-peek-anchor" hidden />
  <Teleport to="body">
    <div
      v-if="shown"
      ref="box"
      class="zen-peek zen-surface"
      data-zen-layer
      :style="{ left: `${pos.left}px`, top: `${pos.top}px`, zIndex: z }"
    >
      <img v-if="shown.kind === 'image'" :src="shown.url" alt="" @load="place" />
      <video
        v-else-if="shown.kind === 'video'"
        :src="shown.url"
        autoplay
        muted
        loop
        playsinline
        @loadedmetadata="place"
      />
      <div v-else class="zen-peek-audio">
        <i class="mdi mdi-waveform" />
        <audio :src="shown.url" controls autoplay />
      </div>
      <div v-if="caption" class="zen-peek-caption">
        <b v-if="shown.label">{{ shown.label }}</b>
        <span v-if="shown.detail">{{ shown.detail }}</span>
      </div>
    </div>
  </Teleport>
</template>

<style>
.zen-peek {
  position: fixed;
  display: flex;
  flex-direction: column;
  max-width: min(560px, 60vw);
  overflow: hidden;
  border-radius: var(--zen-radius, 8px);
  pointer-events: none;
  animation: zen-peek-in var(--zen-dur-fast, 120ms) ease-out;
}
.zen-peek img,
.zen-peek video {
  display: block;
  max-width: min(560px, 60vw);
  max-height: min(480px, 70vh);
  object-fit: contain;
  background: var(--zen-media-bg, #0b0b0e);
}
.zen-peek-audio {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px;
  color: var(--zen-muted, #9aa0aa);
  font-size: 22px;
}
.zen-peek-caption {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-width: 100%;
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.4;
}
.zen-peek-caption span {
  color: var(--zen-muted, #9aa0aa);
}
@keyframes zen-peek-in {
  from {
    opacity: 0;
    transform: scale(0.97);
  }
}
</style>
