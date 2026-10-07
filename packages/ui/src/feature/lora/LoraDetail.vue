<!-- Everything known about one LoRA: preview, Civitai/Lora Manager metadata, the example gallery
     with each image's generation params, and the file header's training info. Examples load from
     the host (e.g. Lora Manager's downloads) and fall back to `remote` when that fails. -->
<template>
  <div class="ld zen-scroll">
    <header class="ld-head">
      <button
        type="button"
        class="ld-cover"
        :disabled="!hasPreview"
        title="Enlarge"
        @click="openPreview"
      >
        <video
          v-if="hasPreview && kind === 'video'"
          :src="lib.media(name)"
          autoplay
          muted
          loop
          playsinline
        />
        <img v-else-if="hasPreview" :src="lib.preview(name)" />
        <i v-else class="mdi mdi-cube-outline" />
      </button>
      <div class="ld-id">
        <div class="ld-title" :title="info?.title || name">
          {{ info?.title || lib.short(name) }}
        </div>
        <div class="ld-file" :title="name">
          {{ name }}
          <template v-if="info?.size">· {{ formatSize(info.size) }}</template>
        </div>
        <div class="ld-chips">
          <span v-if="info?.base_model" class="ld-chip accent">{{ info.base_model }}</span>
          <span v-if="info?.version" class="ld-chip">{{ info.version }}</span>
          <span v-if="info?.creator" class="ld-chip">
            <i class="mdi mdi-account-outline" />
            {{ info.creator }}
          </span>
          <span v-for="(v, k) in info?.usage" :key="k" class="ld-chip">{{ k }} {{ v }}</span>
        </div>
        <div class="ld-actions">
          <ZenIconButton
            :icon="lib.isFav(name) ? 'mdi mdi-star' : 'mdi mdi-star-outline'"
            :active="lib.isFav(name)"
            :title="lib.isFav(name) ? 'Remove bookmark' : 'Bookmark'"
            @click="lib.toggleFav(name)"
          />
          <a v-if="pageUrl" class="ld-link" :href="pageUrl" target="_blank" rel="noopener">
            <i class="mdi mdi-open-in-new" />
            Civitai
          </a>
          <ZenButton v-if="pickable" sm icon="mdi mdi-check" @click="emit('pick', name)">
            Use
          </ZenButton>
        </div>
      </div>
    </header>

    <p v-if="loading" class="ld-muted">Loading…</p>

    <section v-if="info?.trigger_words?.length" class="ld-sec">
      <h4>
        Trigger words
        <button type="button" class="ld-copy" @click="copy('words', info.trigger_words.join(', '))">
          <i class="mdi" :class="copied === 'words' ? 'mdi-check' : 'mdi-content-copy'" />
        </button>
      </h4>
      <div class="ld-chips">
        <button
          v-for="w in info.trigger_words"
          :key="w"
          type="button"
          class="ld-chip word"
          title="Copy"
          @click="copy('w:' + w, w)"
        >
          <i v-if="copied === 'w:' + w" class="mdi mdi-check" />
          {{ w }}
        </button>
      </div>
    </section>

    <section v-if="examples.length" class="ld-sec ld-examples">
      <h4>
        Examples
        <span class="ld-count">{{ examples.length }}</span>
        <button
          v-if="hasMature"
          type="button"
          class="ld-toggle"
          :class="{ on: revealMature }"
          @click="revealMature = !revealMature"
        >
          <i class="mdi" :class="revealMature ? 'mdi-eye-outline' : 'mdi-eye-off-outline'" />
          Mature
        </button>
      </h4>
      <!-- The viewer: the chosen example large, a filmstrip of all of them under it (it keeps the
           chosen one in view), and its generation details beside it when there's room. -->
      <div class="ld-viewer" tabindex="0" @keydown="onViewerKey">
        <div class="ld-look">
          <div v-if="current" class="ld-stage" :class="{ blur: blurred(current) }">
            <button
              type="button"
              class="ld-stage-media"
              title="Open fullscreen"
              @click="openExamples"
            >
              <video
                v-if="current.kind === 'video'"
                :key="srcOf(current)"
                :src="srcOf(current)"
                autoplay
                muted
                loop
                playsinline
                @error="onMediaError(current)"
              />
              <img
                v-else
                :key="srcOf(current)"
                :src="srcOf(current)"
                @error="onMediaError(current)"
              />
            </button>
            <template v-if="examples.length > 1">
              <button type="button" class="ld-nav prev" title="Previous (←)" @click="step(-1)">
                <i class="mdi mdi-chevron-left" />
              </button>
              <button type="button" class="ld-nav next" title="Next (→)" @click="step(1)">
                <i class="mdi mdi-chevron-right" />
              </button>
            </template>
            <span class="ld-counter">{{ sel + 1 }} / {{ examples.length }}</span>
          </div>
          <div
            v-if="examples.length > 1"
            ref="strip"
            class="ld-strip zen-scroll"
            @wheel="onStripWheel"
          >
            <button
              v-for="(ex, i) in examples"
              :key="ex.url || i"
              type="button"
              class="ld-thumb"
              :class="{ sel: i === sel, blur: blurred(ex) }"
              :style="{ width: `${thumbWidth(ex)}px` }"
              :data-i="i"
              :title="`Example ${i + 1}`"
              @click="sel = i"
            >
              <video
                v-if="ex.kind === 'video'"
                :src="srcOf(ex) + '#t=0.1'"
                preload="metadata"
                muted
                @loadedmetadata="measureVideo(ex, $event)"
                @error="onMediaError(ex)"
              />
              <img
                v-else
                :src="thumbOf(ex)"
                loading="lazy"
                @load="measureImage(ex, $event)"
                @error="onMediaError(ex)"
              />
              <i v-if="ex.kind === 'video'" class="mdi mdi-play-circle ld-badge" />
            </button>
          </div>
        </div>
        <div class="ld-params">
          <div v-for="p in prompts" :key="p.key" class="ld-prompt">
            <div class="ld-k">
              {{ p.label }}
              <button type="button" class="ld-copy" @click="copy(p.key, p.text)">
                <i class="mdi" :class="copied === p.key ? 'mdi-check' : 'mdi-content-copy'" />
              </button>
            </div>
            <div class="ld-text">{{ p.text }}</div>
          </div>
          <dl v-if="params.length" class="ld-kv">
            <template v-for="p in params" :key="p.key">
              <dt>{{ p.label }}</dt>
              <dd :title="p.text">{{ p.text }}</dd>
            </template>
          </dl>
          <p v-if="!prompts.length && !params.length" class="ld-muted">
            No generation details were published for this example.
          </p>
        </div>
      </div>
    </section>

    <section v-if="info?.tags?.length" class="ld-sec">
      <h4>Tags</h4>
      <div class="ld-chips">
        <span v-for="t in info.tags" :key="t" class="ld-chip">{{ t }}</span>
      </div>
    </section>

    <section v-if="description" class="ld-sec">
      <h4>About</h4>
      <div class="ld-desc" :class="{ open: descOpen }">{{ description }}</div>
      <button
        v-if="description.length > 400"
        type="button"
        class="ld-more"
        @click="descOpen = !descOpen"
      >
        {{ descOpen ? 'Show less' : 'Show more' }}
      </button>
    </section>

    <section v-if="info?.notes" class="ld-sec">
      <h4>Notes</h4>
      <div class="ld-desc open">{{ info.notes }}</div>
    </section>

    <section v-if="training.length" class="ld-sec">
      <h4>Training</h4>
      <dl class="ld-kv">
        <template v-for="p in training" :key="p.key">
          <dt>{{ p.label }}</dt>
          <dd :title="p.text">{{ p.text }}</dd>
        </template>
      </dl>
    </section>

    <p v-if="!loading && isBare" class="ld-muted">
      No metadata found. A
      <code>.metadata.json</code>
      sidecar (as written by Lora Manager) adds Civitai details and example images.
    </p>

    <ZenLightbox
      v-if="lightbox"
      :items="lightbox.items"
      :index="lightbox.index"
      @update:index="lightbox.index = $event"
      @close="lightbox = null"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import ZenButton from '../../primitives/ZenButton.vue'
import ZenIconButton from '../../primitives/ZenIconButton.vue'
import ZenLightbox from '../ZenLightbox.vue'
import type { LightboxItem } from '../../types'
import '../../lib/scrollbar.css'

import { safeLinkUrl, safeMediaUrl } from '../../lib/safeUrl'
import * as lib from './loraLibrary'
import { revealMature } from './loraState'
import type { LoraExample, LoraInfo } from './types'

const props = withDefaults(defineProps<{ name: string; pickable?: boolean }>(), {
  pickable: false,
})
const emit = defineEmits<{ pick: [string] }>()

const MATURE_LEVEL = 4
const PROMPT_KEYS: [string, string][] = [
  ['prompt', 'Prompt'],
  ['negativePrompt', 'Negative'],
]
const PARAM_ORDER = ['Model', 'sampler', 'scheduler', 'steps', 'cfgScale', 'seed', 'Size']
const LABELS: Record<string, string> = { cfgScale: 'CFG', clipSkip: 'Clip skip', Size: 'Size' }

const info = ref<LoraInfo | null>(null)
const loading = ref(false)
const sel = ref(0)
const descOpen = ref(false)
const copied = ref('')
const lightbox = ref<{ items: LightboxItem[]; index: number } | null>(null)
// Examples whose host copy failed to load, and aspect ratios measured from loaded media.
const failed = ref<Set<string>>(new Set())
const ratios = ref<Record<string, number>>({})

watch(
  () => props.name,
  (name) => {
    info.value = null
    sel.value = 0
    descOpen.value = false
    lightbox.value = null
    failed.value = new Set()
    ratios.value = {}
    if (!name) return
    loading.value = true
    void lib.ensure()
    void lib.info(name).then((i) => {
      if (props.name !== name) return
      info.value = i
      loading.value = false
    })
  },
  { immediate: true },
)

const kind = computed(() => lib.previewKind(props.name) ?? info.value?.preview ?? null)
const hasPreview = computed(() => !!kind.value || lib.hasThumb(props.name))
const examples = computed(() => info.value?.images ?? [])
/** The LoRA's page on the web, if its metadata gives a real http(s) one. */
const pageUrl = computed(() => safeLinkUrl(info.value?.url))
const current = computed<LoraExample | undefined>(() => examples.value[sel.value])
const hasMature = computed(
  () => lib.blurMature.value && examples.value.some((e) => (e.nsfw_level ?? 0) >= MATURE_LEVEL),
)
const description = computed(() =>
  [info.value?.description, info.value?.version_description].filter(Boolean).join('\n\n'),
)
const isBare = computed(
  () => !info.value?.title && !examples.value.length && !training.value.length,
)

function blurred(ex: LoraExample): boolean {
  return lib.blurMature.value && !revealMature.value && (ex.nsfw_level ?? 0) >= MATURE_LEVEL
}

/** Where an example loads from: its host copy, or `remote` once that failed. Both come from the
 *  LoRA's metadata (untrusted), so only a safe media URL is used; anything else shows nothing. */
function srcOf(ex: LoraExample): string {
  return safeMediaUrl(failed.value.has(ex.url) && ex.remote ? ex.remote : ex.url) ?? ''
}

/** Civitai serves resized variants by swapping the `original=true` path segment. */
function thumbOf(ex: LoraExample): string {
  const src = srcOf(ex)
  return src === ex.remote ? src.replace('/original=true/', '/width=320/') : src
}

function onMediaError(ex: LoraExample) {
  if (ex.remote && ex.remote !== ex.url && !failed.value.has(ex.url))
    failed.value = new Set(failed.value).add(ex.url)
}

/** Filmstrip thumbnails: one height, each as wide as its picture's shape (within limits). */
const THUMB_H = 64

function ratioOf(ex: LoraExample): number {
  const measured = ratios.value[ex.url]
  if (measured) return measured
  return ex.width && ex.height ? ex.width / ex.height : 0.75
}

function thumbWidth(ex: LoraExample): number {
  return Math.round(Math.min(Math.max(THUMB_H * ratioOf(ex), 40), 120))
}

// --- the viewer ---------------------------------------------------------------------------------
const strip = ref<HTMLElement | null>(null)
function step(by: number) {
  const n = examples.value.length
  if (n) sel.value = (sel.value + by + n) % n
}
function onViewerKey(e: KeyboardEvent) {
  const by = {
    ArrowLeft: -1,
    ArrowRight: 1,
    Home: -sel.value,
    End: examples.value.length - 1 - sel.value,
  }[e.key]
  if (by === undefined) return
  e.preventDefault()
  step(by)
}
/** A mouse wheel scrolls the filmstrip sideways. */
function onStripWheel(e: WheelEvent) {
  const el = strip.value
  if (!el || Math.abs(e.deltaX) > Math.abs(e.deltaY) || el.scrollWidth <= el.clientWidth) return
  e.preventDefault()
  el.scrollLeft += e.deltaY
}
// The chosen example's thumbnail stays in view, however it was chosen.
watch(sel, (i) =>
  nextTick(() =>
    strip.value
      ?.querySelector(`[data-i="${i}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' }),
  ),
)

function setRatio(ex: LoraExample, w: number, h: number) {
  if (w > 0 && h > 0 && Math.abs(w / h - ratioOf(ex)) > 0.01)
    ratios.value = { ...ratios.value, [ex.url]: w / h }
}
function measureImage(ex: LoraExample, e: Event) {
  const img = e.target as HTMLImageElement
  setRatio(ex, img.naturalWidth, img.naturalHeight)
}
function measureVideo(ex: LoraExample, e: Event) {
  const v = e.target as HTMLVideoElement
  setRatio(ex, v.videoWidth, v.videoHeight)
}

function label(key: string): string {
  return (
    LABELS[key] ?? key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())
  )
}

function text(v: unknown): string {
  return Array.isArray(v) ? v.join(', ') : String(v)
}

const prompts = computed(() => {
  const meta = current.value?.meta ?? {}
  return PROMPT_KEYS.filter(([k]) => meta[k] != null && String(meta[k]).trim()).map(
    ([key, lbl]) => ({ key, label: lbl, text: text(meta[key]) }),
  )
})

const params = computed(() => {
  const meta = current.value?.meta ?? {}
  const rank = (k: string) => {
    const i = PARAM_ORDER.indexOf(k)
    return i < 0 ? PARAM_ORDER.length : i
  }
  return Object.keys(meta)
    .filter((k) => !PROMPT_KEYS.some(([p]) => p === k) && text(meta[k]) !== '')
    .sort((a, b) => rank(a) - rank(b))
    .map((key) => ({ key, label: label(key), text: text(meta[key]) }))
})

const training = computed(() =>
  Object.entries(info.value?.training ?? {}).map(([key, v]) => ({
    key,
    label: label(key.replace(/_/g, ' ')),
    text: text(v),
  })),
)

function formatSize(bytes: number): string {
  if (bytes >= 1 << 30) return (bytes / (1 << 30)).toFixed(2) + ' GB'
  return (bytes / (1 << 20)).toFixed(1) + ' MB'
}

let copyTimer: ReturnType<typeof setTimeout> | undefined
async function copy(key: string, value: string) {
  try {
    await navigator.clipboard.writeText(value)
  } catch {
    return
  }
  copied.value = key
  clearTimeout(copyTimer)
  copyTimer = setTimeout(() => (copied.value = ''), 1200)
}
onBeforeUnmount(() => clearTimeout(copyTimer))

function openPreview() {
  if (!hasPreview.value) return
  const video = kind.value === 'video'
  lightbox.value = {
    items: [
      {
        src: video ? lib.media(props.name) : lib.preview(props.name),
        kind: video ? 'video' : 'image',
        label: info.value?.title || lib.short(props.name),
      },
    ],
    index: 0,
  }
}

function openExamples() {
  lightbox.value = {
    items: examples.value.map((ex, i) => ({
      src: srcOf(ex),
      kind: ex.kind,
      label: `${info.value?.title || lib.short(props.name)} · ${i + 1}/${examples.value.length}`,
      meta: ex.width && ex.height ? `${ex.width}×${ex.height}` : undefined,
    })),
    index: sel.value,
  }
}
</script>

<style scoped>
.ld {
  height: 100%;
  box-sizing: border-box;
  overflow: auto;
  padding: 12px 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  color: var(--zen-text, #e5e5ea);
  font-size: 12px;
}
.ld-head {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.ld-cover {
  flex: none;
  width: 104px;
  height: 136px;
  padding: 0;
  border: 1px solid var(--zen-border, #34343c);
  border-radius: var(--zen-radius, 7px);
  background: var(--zen-input, #1b1b20);
  overflow: hidden;
  cursor: zoom-in;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ld-cover:disabled {
  cursor: default;
}
.ld-cover img,
.ld-cover video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
.ld-cover > .mdi {
  font-size: 32px;
  color: var(--zen-muted, #9aa0aa);
}
.ld-id {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.ld-title {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.ld-file {
  font-size: 10.5px;
  color: var(--zen-muted, #9aa0aa);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ld-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.ld-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font: inherit;
  font-size: 11px;
  padding: 2px 8px;
  border: 1px solid var(--zen-border, #34343c);
  border-radius: 999px;
  background: var(--zen-input, #1b1b20);
  color: var(--zen-text, #e5e5ea);
}
.ld-chip.accent {
  border-color: transparent;
  background: color-mix(in srgb, var(--zen-accent, #6366f1) 22%, transparent);
}
.ld-chip.word {
  cursor: pointer;
}
.ld-chip.word:hover {
  border-color: var(--zen-accent, #6366f1);
}
.ld-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
}
.ld-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11.5px;
  color: var(--zen-accent, #6366f1);
  text-decoration: none;
}
.ld-link:hover {
  text-decoration: underline;
}
.ld-sec {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.ld-sec h4 {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--zen-muted, #9aa0aa);
}
.ld-count {
  font-weight: 400;
}
.ld-copy,
.ld-toggle,
.ld-more {
  border: none;
  background: none;
  padding: 0 2px;
  font: inherit;
  cursor: pointer;
  color: var(--zen-muted, #9aa0aa);
  display: inline-flex;
  align-items: center;
  gap: 3px;
  text-transform: none;
  letter-spacing: 0;
}
.ld-copy:hover,
.ld-toggle:hover,
.ld-more:hover,
.ld-toggle.on {
  color: var(--zen-text, #e5e5ea);
}
.ld-toggle {
  margin-left: auto;
  font-size: 11px;
}
.ld-more {
  align-self: flex-start;
  font-size: 11px;
  color: var(--zen-accent, #6366f1);
}
/* The viewer: stage and filmstrip, with the details beside them when the panel is wide enough. */
/* The section is the container (a container can't restyle itself from its own query). */
.ld-examples {
  container: ld-examples / inline-size;
}
.ld-viewer {
  display: flex;
  flex-direction: column;
  gap: 12px;
  outline: none;
}
.ld-look {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
@container ld-examples (min-width: 560px) {
  .ld-viewer {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(200px, 38%);
    align-items: start;
  }
}
.ld-stage {
  position: relative;
  display: flex;
  height: 340px;
  overflow: hidden;
  border: 1px solid var(--zen-border, #34343c);
  border-radius: var(--zen-radius, 7px);
  background: var(--zen-media-bg, #0b0b0e);
}
.ld-stage-media {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  padding: 0;
  border: 0;
  background: none;
  cursor: zoom-in;
}
.ld-stage-media img,
.ld-stage-media video {
  display: block;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.ld-nav {
  position: absolute;
  top: 50%;
  display: grid;
  place-items: center;
  width: 30px;
  height: 44px;
  padding: 0;
  border: 0;
  border-radius: var(--zen-radius, 7px);
  background: rgb(0 0 0 / 45%);
  color: #fff;
  font-size: 22px;
  opacity: 0;
  transform: translateY(-50%);
  cursor: pointer;
  transition: opacity var(--zen-dur-fast, 0.12s) ease;
}
.ld-nav.prev {
  left: 6px;
}
.ld-nav.next {
  right: 6px;
}
.ld-stage:hover .ld-nav,
.ld-nav:focus-visible {
  opacity: 1;
}
.ld-nav:hover {
  background: rgb(0 0 0 / 65%);
}
.ld-counter {
  position: absolute;
  right: 8px;
  bottom: 8px;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgb(0 0 0 / 55%);
  color: #fff;
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}
.ld-strip {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: 4px;
}
.ld-thumb {
  position: relative;
  flex: none;
  height: 64px;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--zen-border, #34343c);
  border-radius: calc(var(--zen-radius, 7px) - 2px);
  background: var(--zen-media-bg, #0b0b0e);
  opacity: 0.7;
  cursor: pointer;
  transition: opacity var(--zen-dur-fast, 0.12s) ease;
}
.ld-thumb:hover,
.ld-thumb.sel {
  opacity: 1;
}
.ld-thumb.sel {
  border-color: var(--zen-accent, #6366f1);
  box-shadow: inset 0 0 0 1px var(--zen-accent, #6366f1);
}
.ld-thumb img,
.ld-thumb video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.ld-badge {
  position: absolute;
  right: 3px;
  bottom: 3px;
  font-size: 14px;
  color: #fff;
  text-shadow: 0 1px 3px rgb(0 0 0 / 70%);
}
.blur img,
.blur video {
  filter: blur(14px);
}
.ld-params {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ld-k {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  font-weight: 600;
  color: var(--zen-muted, #9aa0aa);
}
.ld-text {
  max-height: 140px;
  overflow: auto;
  padding: 6px 8px;
  border-radius: var(--zen-radius, 7px);
  background: var(--zen-input, #1b1b20);
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.45;
  user-select: text;
}
.ld-kv {
  margin: 0;
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 3px 10px;
  font-size: 11.5px;
}
.ld-kv dt {
  color: var(--zen-muted, #9aa0aa);
}
.ld-kv dd {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  user-select: text;
}
.ld-desc {
  white-space: pre-wrap;
  line-height: 1.5;
  user-select: text;
  display: -webkit-box;
  -webkit-line-clamp: 8;
  line-clamp: 8;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.ld-desc.open {
  display: block;
}
.ld-muted {
  margin: 0;
  color: var(--zen-muted, #9aa0aa);
  font-size: 11.5px;
}
</style>
