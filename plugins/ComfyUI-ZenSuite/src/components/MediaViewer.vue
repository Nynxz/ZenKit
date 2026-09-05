<script setup lang="ts">
// Media Viewer — the merged Compare + SyncView panel, driven by ZenKit's channel
// image bus. One panel, two modes:
//   • view    — the live feed of one channel (or $last = most recent on any
//               channel): an inline ZenLightbox stage + history strip + slideshow.
//   • compare — two channels side-by-side under a draggable split slider.
// Multi-instance: open several viewers, each watching a different channel. Per-
// instance state (mode, channels, thumbs, slideshow) is persisted via PanelContext.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ZenLightbox, ZenSelect, ZenToggleGroup, type LightboxItem } from '@nynxz/zenkit-ui'
import { getZenKit, type ChannelImage, type PanelContext } from '@nynxz/zenkit-client'

const MODE_OPTIONS = [
  { value: 'view', icon: 'mdi mdi-image-outline', title: 'Single / live view' },
  { value: 'compare', icon: 'mdi mdi-compare', title: 'Compare two channels' },
]

const props = defineProps<{ ctx?: PanelContext }>()
const zen = getZenKit()

type Mode = 'view' | 'compare'

// --- persisted per-instance state ------------------------------------------
const saved = (props.ctx?.state as Record<string, unknown>) || {}
const mode = ref<Mode>(saved.mode === 'compare' ? 'compare' : 'view')
const chan = ref<string>(typeof saved.chan === 'string' ? saved.chan : '')
const chanA = ref<string>(typeof saved.chanA === 'string' ? saved.chanA : '')
const chanB = ref<string>(typeof saved.chanB === 'string' ? saved.chanB : '')
const showThumbs = ref<boolean>(saved.showThumbs !== false)
const slideMs = ref<number>(typeof saved.slideMs === 'number' ? saved.slideMs : 3000)
watch([mode, chan, chanA, chanB, showThumbs, slideMs], () => {
  props.ctx?.setState({
    mode: mode.value,
    chan: chan.value,
    chanA: chanA.value,
    chanB: chanB.value,
    showThumbs: showThumbs.value,
    slideMs: slideMs.value,
  })
})

// --- channel state ----------------------------------------------------------
// byName/last mirror the bus (reactively) for the compare URLs + the datalist;
// `history` is this viewer's own newest-first feed for the selected channel.
const byName = ref<Record<string, ChannelImage>>({})
const last = ref<ChannelImage | null>(null)
const names = computed(() => Object.keys(byName.value))

// Channel dropdown options: a "Most recent" default + the channels actually seen on
// the bus + whatever's currently selected (so a persisted pick survives). No more
// free-form typing, and no arbitrary preset names.
const chanOptions = computed(() => {
  const set = new Set<string>(names.value)
  for (const v of [chan.value, chanA.value, chanB.value]) if (v) set.add(v)
  return [{ value: '', label: '✦ Most recent' }, ...[...set].map((n) => ({ value: n, label: n }))]
})

interface HItem extends ChannelImage {
  n: number // stable key (survives reorder/removal)
}
const history = ref<HItem[]>([])
const selectedN = ref<number | null>(null)
let counter = 0
const MAX_HISTORY = 50

function pushHistory(img: ChannelImage) {
  const it: HItem = { ...img, n: ++counter }
  history.value = [it, ...history.value].slice(0, MAX_HISTORY)
  selectedN.value = it.n // newest becomes the shown one
}
function reseedView() {
  history.value = []
  selectedN.value = null
  counter = 0
  if (!zen) return
  const seed = zen.channels.get(chan.value.trim() || '$last')
  if (seed) pushHistory(seed)
}
watch(chan, reseedView)

const unsubs: Array<() => void> = []
onMounted(() => {
  if (!zen) return
  for (const name of zen.channels.list()) {
    const r = zen.channels.get(name)
    if (r) byName.value[name] = r
  }
  last.value = zen.channels.last()
  // One subscription to every publish ($last): update the mirror, and append to
  // this viewer's history when the image is on the channel it's watching.
  unsubs.push(
    zen.channels.subscribe('$last', (img) => {
      byName.value = { ...byName.value, [img.channel]: img }
      last.value = img
      const target = chan.value.trim()
      if (!target || img.channel === target) pushHistory(img)
    }),
  )
  reseedView()
})
onBeforeUnmount(() => {
  for (const u of unsubs) u()
})

// --- view mode --------------------------------------------------------------
const lb = ref<InstanceType<typeof ZenLightbox> | null>(null)
const ddOpen = ref(false)
const INTERVALS = [1000, 2000, 3000, 5000, 10000]
const zoomPct = computed(() => Math.round((lb.value?.zoom ?? 1) * 100))
const playing = computed(() => lb.value?.playing ?? false)

function timeOf(ts: number) {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
function dims(it: HItem) {
  return it.width ? `${it.width} × ${it.height}` : ''
}
const current = computed<HItem | null>(
  () => history.value.find((i) => i.n === selectedN.value) ?? history.value[0] ?? null,
)
const lbItems = computed<LightboxItem[]>(() =>
  history.value.map((it) => ({
    src: it.url,
    kind: it.kind || 'image',
    label: it.channel || 'image',
    meta: [dims(it), timeOf(it.ts)].filter(Boolean).join('  ·  '),
  })),
)
const lbIndex = computed(() => {
  const c = current.value
  const i = c ? history.value.findIndex((h) => h.n === c.n) : 0
  return i < 0 ? 0 : i
})
function onIndex(i: number) {
  const it = history.value[i]
  if (it) selectedN.value = it.n
}
function setInterval(ms: number) {
  slideMs.value = ms
  ddOpen.value = false
}
function pick(it: HItem) {
  selectedN.value = it.n
}
function removeItem(it: HItem, ev?: Event) {
  ev?.stopPropagation()
  const idx = history.value.findIndex((i) => i.n === it.n)
  if (idx === -1) return
  const next = history.value.filter((i) => i.n !== it.n)
  history.value = next
  if (selectedN.value === it.n) selectedN.value = (next[idx] ?? next[idx - 1] ?? next[0])?.n ?? null
}
function clearHistory() {
  history.value = []
  selectedN.value = null
}

// --- compare mode -----------------------------------------------------------
const pos = ref(50)
const dragging = ref(false) // hide the handle while actively sliding
const stage = ref<HTMLElement | null>(null)
const stageW = ref(0)
function resolve(name: string): ChannelImage | null {
  const n = (name || '').trim()
  return !n ? last.value : (byName.value[n] ?? null)
}
const itemA = computed(() => resolve(chanA.value))
const itemB = computed(() => resolve(chanB.value))
const urlA = computed(() => itemA.value?.url || '')
const urlB = computed(() => itemB.value?.url || '')
const kindA = computed(() => itemA.value?.kind || 'image')
const kindB = computed(() => itemB.value?.kind || 'image')
function swap() {
  const t = chanA.value
  chanA.value = chanB.value
  chanB.value = t
}

let ro: ResizeObserver | null = null
function measure() {
  if (stage.value) stageW.value = stage.value.clientWidth
}
watch([mode, stage], () => {
  measure()
  if (mode.value === 'compare' && stage.value && typeof ResizeObserver !== 'undefined') {
    ro?.disconnect()
    ro = new ResizeObserver(measure)
    ro.observe(stage.value)
  }
})
onBeforeUnmount(() => ro?.disconnect())
function startDrag(e: PointerEvent) {
  const el = stage.value
  if (!el) return
  dragging.value = true
  const move = (m: PointerEvent) => {
    const r = el.getBoundingClientRect()
    pos.value = Math.max(0, Math.min(100, ((m.clientX - r.left) / r.width) * 100))
  }
  move(e)
  const up = () => {
    dragging.value = false
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}
</script>

<template>
  <div class="mv">
    <!-- header: mode toggle + per-mode controls -->
    <div class="mv-head">
      <ZenToggleGroup
        :model-value="mode"
        :options="MODE_OPTIONS"
        @update:model-value="(v) => (mode = v as Mode)"
      />
      <span class="mv-sep" />

      <!-- view-mode controls -->
      <template v-if="mode === 'view'">
        <label class="pick">
          <i class="mdi mdi-pound" />
          <ZenSelect
            :model-value="chan"
            :options="chanOptions"
            placeholder="✦ Most recent"
            @update:model-value="(v) => (chan = String(v))"
          />
        </label>
        <span class="grow" />
        <button
          v-if="history.length"
          class="tb"
          :class="{ on: showThumbs }"
          title="Toggle thumbnails"
          @click="showThumbs = !showThumbs"
        >
          <i class="mdi mdi-view-gallery-outline" />
        </button>
        <button v-if="history.length" class="tb danger" title="Clear history" @click="clearHistory">
          <i class="mdi mdi-delete-sweep-outline" />
        </button>
      </template>

      <!-- compare-mode controls -->
      <template v-else>
        <label class="pick">
          <ZenSelect
            :model-value="chanA"
            :options="chanOptions"
            placeholder="✦ Most recent"
            @update:model-value="(v) => (chanA = String(v))"
          />
        </label>
        <button class="tb cmp-swap" title="Swap the two channels" @click="swap">
          <i class="mdi mdi-swap-horizontal" />
        </button>
        <label class="pick">
          <ZenSelect
            :model-value="chanB"
            :options="chanOptions"
            placeholder="✦ Most recent"
            @update:model-value="(v) => (chanB = String(v))"
          />
        </label>
        <span class="grow" />
        <span class="seen">
          {{ names.length ? names.length + ' channel(s)' : 'no channels yet' }}
        </span>
      </template>
    </div>

    <!-- stage -->
    <div class="mv-stage">
      <template v-if="mode === 'view'">
        <ZenLightbox
          v-if="history.length"
          ref="lb"
          inline
          controls="none"
          :items="lbItems"
          :index="lbIndex"
          :slideshow-ms="slideMs"
          @update:index="onIndex"
        />
        <div v-else class="mv-empty">
          <i class="mdi mdi-image-sync-outline mv-empty-icon" />
          <p class="mv-empty-title">Waiting for an image…</p>
          <p class="mv-empty-sub">
            Run a
            <b>Zen Sync Image</b>
            node on a channel, then watch it here (blank = most recent on any channel).
          </p>
        </div>
      </template>

      <div v-else ref="stage" class="cmp-stage" @pointerdown="startDrag">
        <template v-if="urlB">
          <video
            v-if="kindB === 'video'"
            :src="urlB + '#t=0.1'"
            class="layer"
            muted
            preload="metadata"
            playsinline
          />
          <img v-else :src="urlB" class="layer" draggable="false" alt="" />
        </template>
        <div class="clipA" :style="{ width: pos + '%' }">
          <template v-if="urlA">
            <video
              v-if="kindA === 'video'"
              :src="urlA + '#t=0.1'"
              class="layer"
              :style="{ width: stageW + 'px' }"
              muted
              preload="metadata"
              playsinline
            />
            <img
              v-else
              :src="urlA"
              class="layer"
              :style="{ width: stageW + 'px' }"
              draggable="false"
              alt=""
            />
          </template>
        </div>
        <div v-show="dragging && (urlA || urlB)" class="divider" :style="{ left: pos + '%' }"></div>
        <div v-if="urlA || urlB" class="cmp-notch" :style="{ left: pos + '%' }">
          <span class="nt top" />
          <span class="nt bottom" />
        </div>
        <div v-if="!urlA && !urlB" class="mv-empty">
          <i class="mdi mdi-compare mv-empty-icon" />
          <p class="mv-empty-title">
            {{ names.length ? 'Pick a channel per side' : 'No images published yet' }}
          </p>
          <p class="mv-empty-sub">
            Type a channel name into A and B (blank = most recent). Drive each side with a separate
            Zen Sync Image node.
          </p>
        </div>
      </div>
    </div>

    <!-- slim bottom bar: view manipulation, only while viewing an image -->
    <div v-if="mode === 'view' && history.length" class="mv-foot">
      <button class="tb" title="Previous" :disabled="lbIndex <= 0" @click="lb?.prev()">
        <i class="mdi mdi-chevron-left" />
      </button>
      <button class="tb" title="Next" :disabled="lbIndex >= history.length - 1" @click="lb?.next()">
        <i class="mdi mdi-chevron-right" />
      </button>
      <span class="mv-sep" />
      <button class="tb" title="Zoom out" @click="lb?.zoomOut()">
        <i class="mdi mdi-magnify-minus-outline" />
      </button>
      <span class="mv-z">{{ zoomPct }}%</span>
      <button class="tb" title="Zoom in" @click="lb?.zoomIn()">
        <i class="mdi mdi-magnify-plus-outline" />
      </button>
      <button class="tb" title="Fit / reset" @click="lb?.reset()">
        <i class="mdi mdi-fit-to-screen-outline" />
      </button>
      <span class="mv-sep" />
      <button class="tb" title="Rotate left" @click="lb?.rotate(-90)">
        <i class="mdi mdi-rotate-left" />
      </button>
      <button class="tb" title="Rotate right" @click="lb?.rotate(90)">
        <i class="mdi mdi-rotate-right" />
      </button>
      <span class="mv-sep" />
      <div class="mv-dd up">
        <button class="tb" :class="{ on: playing }" title="Slideshow" @click="lb?.togglePlay()">
          <i class="mdi" :class="playing ? 'mdi-pause' : 'mdi-play'" />
        </button>
        <button class="tb caret" title="Slideshow interval" @click="ddOpen = !ddOpen">
          <i class="mdi mdi-menu-up" />
        </button>
        <div v-if="ddOpen" class="mv-dd-menu up">
          <div class="mv-dd-h">Slideshow interval</div>
          <button
            v-for="ms in INTERVALS"
            :key="ms"
            :class="{ on: slideMs === ms }"
            @click="setInterval(ms)"
          >
            {{ ms / 1000 }}s
          </button>
        </div>
      </div>
    </div>

    <!-- view-mode thumbnail strip -->
    <div v-if="mode === 'view' && history.length && showThumbs" class="mv-strip">
      <div
        v-for="it in history"
        :key="it.n"
        class="mv-thumb"
        :class="{ active: current && it.n === current.n }"
        :title="(it.channel ? it.channel + ' — ' : '') + timeOf(it.ts)"
        @click="pick(it)"
      >
        <video
          v-if="it.kind === 'video'"
          :src="it.url + '#t=0.1'"
          muted
          preload="metadata"
          playsinline
        ></video>
        <i v-else-if="it.kind === 'audio'" class="mdi mdi-music-note mv-thumb-ic"></i>
        <img v-else :src="it.url" alt="" />
        <i v-if="it.kind === 'video'" class="mdi mdi-play-circle mv-thumb-badge"></i>
        <button class="mv-thumb-x" title="Remove" @click="removeItem(it, $event)">
          <i class="mdi mdi-close" />
        </button>
      </div>
    </div>

    <div v-if="ddOpen" class="mv-dd-backdrop" @click="ddOpen = false" />
  </div>
</template>

<style scoped>
.mv {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  background: var(--zen-bg, #1a1a1f);
  color: var(--zen-text, #e5e5ea);
  font-family: var(--p-font-family, system-ui, sans-serif);
}

/* header */
.mv-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 5px 8px;
  font-size: 12px;
  border-bottom: 1px solid var(--zen-border, rgba(255, 255, 255, 0.08));
  flex-wrap: wrap;
}
.grow {
  flex: 1;
}
.mv-sep {
  width: 1px;
  align-self: stretch;
  margin: 3px 4px;
  background: var(--zen-border, rgba(255, 255, 255, 0.1));
}

.pick {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--zen-muted, #9aa0aa);
}
.pick .lbl {
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 700;
}
.pick .mdi {
  font-size: 14px;
  opacity: 0.7;
}
.pick :deep(.zen-select) {
  min-width: 120px;
}
.pick :deep(.zs-trigger) {
  width: 100%;
}
.cin {
  font-size: 12px;
  font-family: inherit;
  padding: 4px 8px;
  border-radius: var(--zen-radius, 6px);
  width: 120px;
  background: var(--zen-surface, #202026);
  color: var(--zen-text, #e5e5ea);
  border: 1px solid var(--zen-border, #3a3a44);
}
.cin:focus {
  outline: none;
  border-color: var(--zen-accent, #3b82f6);
}
.seen {
  font-size: 11px;
  color: var(--zen-muted, #9aa0aa);
  white-space: nowrap;
}

.tb {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: var(--zen-radius, 5px);
  background: transparent;
  color: var(--zen-text, #e5e5ea);
  cursor: pointer;
}
.tb:hover {
  background: color-mix(in srgb, var(--zen-text, #fff) 12%, transparent);
}
.tb:disabled {
  opacity: 0.3;
  cursor: default;
}
.tb.on {
  background: var(--zen-accent, #3b82f6);
  color: var(--zen-accent-text, #fff);
}
.tb.danger:hover {
  background: #b91c1c;
  color: #fff;
}
.tb .mdi {
  font-size: 16px;
}
/* stretch to the row height so it always matches the (content-height) channel pickers */
.cmp-swap {
  width: 30px;
  height: auto;
  align-self: stretch;
  background: color-mix(in srgb, var(--zen-accent, #3b82f6) 16%, transparent);
  border: 1px solid var(--zen-border, #2a2c34);
  color: var(--zen-accent, #3b82f6);
}
.cmp-swap:hover {
  background: var(--zen-accent, #3b82f6);
  color: var(--zen-accent-text, #fff);
}
.tb.caret {
  width: 16px;
}
.mv-z {
  font-size: 11px;
  color: var(--zen-muted, #9aa0aa);
  min-width: 38px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.mv-dd {
  position: relative;
  display: inline-flex;
}
.mv-dd-menu {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 20;
  margin-top: 4px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 120px;
  background: var(--zen-surface, #26262c);
  border: 1px solid var(--zen-border, rgba(255, 255, 255, 0.14));
  border-radius: var(--zen-radius, 8px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}
.mv-dd-h {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--zen-muted, #9aa0aa);
  padding: 2px 4px 4px;
}
.mv-dd-menu button {
  text-align: left;
  padding: 5px 8px;
  font-size: 12px;
  border: none;
  border-radius: var(--zen-radius, 5px);
  background: transparent;
  color: var(--zen-text, #e5e5ea);
  cursor: pointer;
}
.mv-dd-menu button:hover {
  background: color-mix(in srgb, var(--zen-text, #fff) 10%, transparent);
}
.mv-dd-menu button.on {
  background: var(--zen-accent, #3b82f6);
  color: var(--zen-accent-text, #fff);
}
.mv-dd-backdrop {
  position: fixed;
  inset: 0;
  z-index: 15;
}
/* slideshow menu flipped to open upward (the dropdown now lives in the bottom bar) */
.mv-dd-menu.up {
  top: auto;
  bottom: 100%;
  margin-top: 0;
  margin-bottom: 4px;
}

/* slim bottom control bar: nav + zoom + rotate + slideshow, centered */
.mv-foot {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 5px 8px;
  border-top: 1px solid var(--zen-border, rgba(255, 255, 255, 0.08));
  background: var(--zen-surface-2, rgba(0, 0, 0, 0.18));
}

/* stage (positioned so the inline ZenLightbox / compare layers fill it) */
.mv-stage {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
}

.mv-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  text-align: center;
  padding: 24px;
  opacity: 0.85;
  color: var(--zen-muted, #9aa0aa);
}
.mv-empty-icon {
  font-size: 46px;
  opacity: 0.5;
  margin-bottom: 4px;
}
.mv-empty-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--zen-text);
}
.mv-empty-sub {
  margin: 0;
  font-size: 12.5px;
  opacity: 0.75;
  max-width: 300px;
}

/* compare stage */
.cmp-stage {
  position: absolute;
  inset: 0;
  overflow: hidden;
  touch-action: none;
  user-select: none;
  cursor: ew-resize;
  background: repeating-conic-gradient(#1c1c22 0% 25%, #16161b 0% 50%) 50% / 22px 22px;
}
.layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.clipA {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  overflow: hidden;
}
.clipA .layer {
  max-width: none;
}
.divider {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--zen-accent, #3b82f6);
  transform: translateX(-1px);
  pointer-events: none;
}
/* always-visible split hint: triangles at top + bottom pointing inward */
.cmp-notch {
  position: absolute;
  top: 0;
  bottom: 0;
  pointer-events: none;
  z-index: 2;
}
.cmp-notch .nt {
  position: absolute;
  left: 0;
  transform: translateX(-50%);
  width: 0;
  height: 0;
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  filter: drop-shadow(0 0 2px rgba(0, 0, 0, 0.55));
}
.cmp-notch .nt.top {
  top: 0;
  border-top: 9px solid var(--zen-accent, #3b82f6);
}
.cmp-notch .nt.bottom {
  bottom: 0;
  border-bottom: 9px solid var(--zen-accent, #3b82f6);
}

/* thumbnail strip */
.mv-strip {
  flex: 0 0 auto;
  display: flex;
  gap: 6px;
  padding: 8px;
  overflow-x: auto;
  border-top: 1px solid var(--zen-border, rgba(255, 255, 255, 0.08));
  background: var(--zen-surface-2, rgba(0, 0, 0, 0.2));
}
.mv-thumb {
  position: relative;
  flex: 0 0 auto;
  width: 52px;
  height: 52px;
  border: 2px solid transparent;
  border-radius: var(--zen-radius, 5px);
  overflow: hidden;
  cursor: pointer;
  background: var(--zen-input, #15151a);
  transition: border-color 0.12s ease;
}
.mv-thumb img,
.mv-thumb video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.mv-thumb-ic {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  font-size: 22px;
  color: var(--zen-muted, #9aa0aa);
}
.mv-thumb-badge {
  position: absolute;
  top: 1px;
  left: 2px;
  font-size: 12px;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85);
  pointer-events: none;
}
.mv-thumb:hover {
  border-color: var(--zen-muted, rgba(255, 255, 255, 0.3));
}
.mv-thumb.active {
  border-color: var(--zen-accent, #7aa2ff);
}
.mv-thumb-x {
  position: absolute;
  top: 1px;
  right: 1px;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  font-size: 13px;
  line-height: 1;
  color: #fff;
  background: rgba(0, 0, 0, 0.6);
  border: none;
  border-radius: max(3px, calc(var(--zen-radius, 4px) - 1px));
  cursor: pointer;
  opacity: 0;
  transition:
    opacity 0.1s ease,
    background 0.1s ease;
}
.mv-thumb:hover .mv-thumb-x {
  opacity: 1;
}
.mv-thumb-x:hover {
  background: #b91c1c;
}
</style>
