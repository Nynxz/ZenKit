<template>
  <ZenModal
    :open="open"
    :title="title"
    width="1080px"
    height="82vh"
    @update:open="(v: boolean) => !v && close()"
  >
    <template #header>
      <span class="zmp-search">
        <ZenInput v-model="query" sm placeholder="Search names and folders…" />
      </span>
      <ZenToggleGroup :model-value="root" :options="rootOptions" @update:model-value="setRoot" />
      <ZenIconButton icon="mdi mdi-refresh" title="Refresh" @click="load(true)" />
      <ZenButton v-if="library.upload" sm icon="mdi mdi-upload" @click="chooseFiles">
        Upload…
      </ZenButton>
    </template>

    <div
      class="zmp"
      :class="{ dropping }"
      @dragover.prevent="onDragOver"
      @dragleave="onDragLeave"
      @drop.prevent="onDrop"
    >
      <!-- folders -->
      <nav class="zmp-folders zen-scroll">
        <button
          type="button"
          class="zmp-folder"
          :class="{ on: folder === null }"
          @click="folder = null"
        >
          <i class="mdi mdi-folder-multiple-outline" />
          <span class="zmp-fname">All of {{ root }}/</span>
          <span class="zmp-count">{{ ofKind.length }}</span>
        </button>
        <ZenFolderTree
          :folders="folders"
          :model-value="folder"
          storage-key="zenkit.mediaPicker.open"
          @update:model-value="(p) => (folder = p)"
        />
      </nav>

      <!-- grid -->
      <section class="zmp-main">
        <div class="zmp-filters">
          <ZenToggleGroup v-if="kindOptions.length > 2" v-model="kind" :options="kindOptions" />
          <span class="zmp-grow" />
          <ZenToggleGroup v-model="sort" :options="SORTS" />
          <ZenToggleGroup v-model="size" :options="SIZES" />
        </div>
        <div ref="gridEl" class="zmp-grid zen-scroll" :style="grid.containerStyle.value">
          <div :style="grid.padTop.value" />
          <button
            v-for="(it, i) in shownCards"
            :key="it.ref"
            type="button"
            class="zmp-card"
            :class="{ sel: order(it.ref) > 0, focus: focused?.ref === it.ref }"
            :title="it.ref"
            @click="onCard(it, grid.start.value + i, $event)"
            @dblclick="pickNow(it)"
            @mouseenter="hover = it.ref"
            @mouseleave="hover = ''"
          >
            <span class="zmp-thumb">
              <video
                v-if="it.kind === 'video' && hover === it.ref"
                :src="it.url"
                muted
                autoplay
                loop
                playsinline
              />
              <img v-else-if="it.thumb" :src="it.thumb" loading="lazy" decoding="async" alt="" />
              <span v-else class="zmp-audio"><i class="mdi mdi-waveform" /></span>
              <span v-if="it.kind !== 'image'" class="zmp-kind">
                <i class="mdi" :class="it.kind === 'video' ? 'mdi-play' : 'mdi-music-note'" />
              </span>
              <span v-if="order(it.ref)" class="zmp-tick">
                {{ multiple ? order(it.ref) : '' }}
                <i v-if="!multiple" class="mdi mdi-check" />
              </span>
            </span>
            <span class="zmp-name">{{ it.filename }}</span>
            <span v-if="folder === null && it.folder" class="zmp-dir">{{ it.folder }}</span>
          </button>
          <div :style="grid.padBottom.value" />
          <div v-if="state === 'loading'" class="zmp-empty">
            <i class="mdi mdi-loading mdi-spin" />
            Loading {{ root }}/…
          </div>
          <div v-else-if="state === 'error'" class="zmp-empty">
            <i class="mdi mdi-alert-circle-outline" />
            {{ error }}
          </div>
          <div v-else-if="!visible.length" class="zmp-empty">
            <i class="mdi mdi-image-off-outline" />
            {{ query ? `Nothing matches “${query}”.` : `No ${kindWord} here yet.` }}
            <span v-if="library.upload">Drop files here or use Upload.</span>
          </div>
        </div>
      </section>

      <!-- preview -->
      <aside class="zmp-preview">
        <template v-if="focused">
          <div class="zmp-big">
            <img v-if="focused.kind === 'image'" :src="focused.url" alt="" />
            <video
              v-else-if="focused.kind === 'video'"
              :key="focused.ref"
              :src="focused.url"
              controls
              muted
              loop
              playsinline
            />
            <div v-else class="zmp-bigaudio">
              <i class="mdi mdi-waveform" />
              <audio :key="focused.ref" :src="focused.url" controls />
            </div>
          </div>
          <div class="zmp-meta">
            <b :title="focused.filename">{{ focused.filename }}</b>
            <span>{{ focused.root }}/{{ focused.folder ? `${focused.folder}/` : '' }}</span>
            <span>
              {{ KIND_LABEL[focused.kind] }} · {{ bytes(focused.size) }}
              <template v-if="dims">· {{ dims }}</template>
            </span>
            <span>{{ date(focused.mtime) }}</span>
          </div>
        </template>
        <div v-else class="zmp-hint">
          <i class="mdi mdi-gesture-tap" />
          Click to {{ multiple ? 'select (in order)' : 'select' }}, double-click to add right away.
          <template v-if="multiple">Shift-click selects a range.</template>
        </div>
      </aside>

      <div v-if="dropping" class="zmp-drop">
        <i class="mdi mdi-tray-arrow-down" />
        Drop to upload into input/{{ subfolder }}/
      </div>
    </div>

    <template #footer>
      <div class="zmp-foot">
        <span class="zmp-soft">
          <template v-if="picked.length">{{ picked.length }} selected</template>
          <template v-else>{{ visible.length }} {{ kindWord }}</template>
        </span>
        <ZenButton v-if="picked.length" variant="ghost" sm @click="picked = []">Clear</ZenButton>
        <span class="zmp-grow" />
        <ZenButton variant="ghost" sm @click="close">Cancel</ZenButton>
        <ZenButton variant="primary" sm :disabled="!picked.length" @click="confirm">
          {{ confirmLabel }}{{ multiple && picked.length > 1 ? ` ${picked.length}` : '' }}
        </ZenButton>
      </div>
    </template>
  </ZenModal>
</template>

<script setup lang="ts">
// ZenMediaPicker — browse ComfyUI's media folders and pick files: folders down the left, a
// filterable grid of previews (videos play on hover), a large preview of the focused file, and
// desktop files dropped in are uploaded. Selection keeps click order, since order usually means
// something (reference numbering, a batch). Data comes from a `library` — nodekit's
// `mediaLibrary` is one.
import { computed, nextTick, ref, watch } from 'vue'

import ZenFolderTree from '../data/ZenFolderTree.vue'
import ZenInput from '../inputs/ZenInput.vue'
import ZenToggleGroup from '../inputs/ZenToggleGroup.vue'
import ZenModal from '../overlays/ZenModal.vue'
import ZenButton from '../primitives/ZenButton.vue'
import ZenIconButton from '../primitives/ZenIconButton.vue'
import { useVirtualGrid } from '../lib/useVirtualGrid'

export type MediaPickerKind = 'image' | 'video' | 'audio'
export interface MediaPickerItem {
  ref: string
  root: string
  folder: string
  filename: string
  kind: MediaPickerKind
  size: number
  mtime: number
  url: string
  thumb?: string
}
export interface MediaPickerLibrary {
  roots: string[]
  list(root: string, force?: boolean): Promise<MediaPickerItem[]>
  upload?(files: File[], subfolder?: string): Promise<string[]>
}

const props = withDefaults(
  defineProps<{
    open: boolean
    library: MediaPickerLibrary
    kinds?: MediaPickerKind[]
    multiple?: boolean
    title?: string
    confirmLabel?: string
    /** Where uploads land, under input/. */
    subfolder?: string
    /** Refs to show as already selected when the picker opens. */
    selected?: string[]
  }>(),
  {
    kinds: () => ['image', 'video', 'audio'],
    multiple: true,
    title: 'Choose media',
    confirmLabel: 'Add',
    subfolder: 'zenkit',
    selected: () => [],
  },
)
const emit = defineEmits<{ 'update:open': [boolean]; pick: [refs: string[]] }>()

const KIND_LABEL: Record<MediaPickerKind, string> = {
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
}
const KIND_PLURAL: Record<MediaPickerKind, string> = {
  image: 'images',
  video: 'videos',
  audio: 'audio files',
}
const SORTS = [
  { value: 'new', icon: 'mdi mdi-clock-outline', title: 'Newest first' },
  { value: 'name', icon: 'mdi mdi-sort-alphabetical-ascending', title: 'By name' },
]
const SIZES = [
  { value: 's', icon: 'mdi mdi-view-grid-compact', title: 'Small' },
  { value: 'm', icon: 'mdi mdi-view-grid-outline', title: 'Medium' },
  { value: 'l', icon: 'mdi mdi-view-module-outline', title: 'Large' },
]
const CARD: Record<string, number> = { s: 96, m: 136, l: 196 }
const PREFS = 'zenkit.mediaPicker'

const items = ref<MediaPickerItem[]>([])
const state = ref<'idle' | 'loading' | 'error'>('idle')
const error = ref('')
const root = ref(props.library.roots[0] ?? 'input')
const folder = ref<string | null>(null)
const query = ref('')
const kind = ref<'all' | MediaPickerKind>('all')
const sort = ref('new')
const size = ref('m')
const picked = ref<string[]>([])
const focusRef = ref('')
const hover = ref('')
const dims = ref('')
const dropping = ref(false)
const gridEl = ref<HTMLElement | null>(null)
let anchor = -1

try {
  const saved = JSON.parse(localStorage.getItem(PREFS) ?? '{}') as Record<string, string>
  if (saved.sort) sort.value = saved.sort
  if (saved.size) size.value = saved.size
  if (saved.root && props.library.roots.includes(saved.root)) root.value = saved.root
} catch {
  // preferences are a convenience
}
watch([sort, size, root], () => {
  try {
    localStorage.setItem(
      PREFS,
      JSON.stringify({ sort: sort.value, size: size.value, root: root.value }),
    )
  } catch {
    // preferences are a convenience
  }
})

const rootOptions = computed(() =>
  props.library.roots.map((r) => ({ value: r, label: r[0]!.toUpperCase() + r.slice(1) })),
)
const allowed = computed(() => items.value.filter((it) => props.kinds.includes(it.kind)))
const kindOptions = computed(() => [
  { value: 'all', label: `All ${allowed.value.length}` },
  ...props.kinds.map((k) => ({
    value: k,
    label: `${KIND_LABEL[k]} ${allowed.value.filter((it) => it.kind === k).length}`,
    icon: `mdi ${k === 'image' ? 'mdi-image-outline' : k === 'video' ? 'mdi-filmstrip' : 'mdi-music-note-outline'}`,
  })),
])
const ofKind = computed(() =>
  kind.value === 'all' ? allowed.value : allowed.value.filter((it) => it.kind === kind.value),
)
const kindWord = computed(() =>
  kind.value !== 'all'
    ? KIND_PLURAL[kind.value]
    : props.kinds.length === 1
      ? KIND_PLURAL[props.kinds[0]!]
      : 'files',
)

/** Every folder that holds a matching file, with its ancestors, as an indented tree. */
const folders = computed(() => {
  const counts = new Map<string, number>()
  for (const it of ofKind.value) {
    const parts = it.folder ? it.folder.split('/') : []
    for (let d = 0; d <= parts.length; d++) {
      const path = parts.slice(0, d).join('/')
      counts.set(path, (counts.get(path) ?? 0) + (d === parts.length ? 1 : 0))
    }
  }
  const total = (path: string) =>
    [...counts].reduce((n, [p, c]) => n + (p === path || p.startsWith(`${path}/`) ? c : 0), 0)
  return [...counts.keys()]
    .filter((p) => p !== '')
    .sort((a, b) => a.localeCompare(b))
    .map((path) => ({
      path,
      depth: path.split('/').length - 1,
      label: path.split('/').pop()!,
      count: total(path),
    }))
})

const visible = computed(() => {
  const q = query.value.trim().toLowerCase()
  const list = ofKind.value.filter(
    (it) =>
      (folder.value === null ||
        it.folder === folder.value ||
        it.folder.startsWith(`${folder.value}/`)) &&
      (!q || `${it.folder}/${it.filename}`.toLowerCase().includes(q)),
  )
  return sort.value === 'name'
    ? list.sort((a, b) => a.filename.localeCompare(b.filename, undefined, { numeric: true }))
    : list.sort((a, b) => b.mtime - a.mtime)
})
// Only the rows on screen are rendered, so a folder of thousands opens as fast as a small one.
const grid = useVirtualGrid(gridEl, () => visible.value.length, {
  minWidth: () => CARD[size.value]!,
  estimate: (w) => w + 30,
})
const shownCards = computed(() => visible.value.slice(grid.start.value, grid.end.value))
watch(shownCards, () => void nextTick(() => grid.measure('.zmp-card')))
watch([root, folder, query, kind, sort], () => {
  if (gridEl.value) gridEl.value.scrollTop = 0
})

const focused = computed(() => items.value.find((it) => it.ref === focusRef.value) ?? null)
const order = (r: string) => picked.value.indexOf(r) + 1

async function load(force = false) {
  state.value = 'loading'
  try {
    items.value = await props.library.list(root.value, force)
    state.value = 'idle'
    if (folder.value !== null && !folders.value.some((f) => f.path === folder.value))
      folder.value = null
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    state.value = 'error'
  }
}
function setRoot(r: string) {
  root.value = r
  folder.value = null
  anchor = -1
  void load()
}

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    picked.value = [...props.selected]
    focusRef.value = props.selected[0] ?? ''
    query.value = ''
    kind.value = props.kinds.length === 1 ? props.kinds[0]! : 'all'
    anchor = -1
    const fromSelection = props.selected[0]?.split('/')[0]
    if (fromSelection && props.library.roots.includes(fromSelection)) root.value = fromSelection
    void load()
  },
  { immediate: true },
)

watch(focused, (it) => {
  dims.value = ''
  if (!it || it.kind === 'audio') return
  const done = (w: number, h: number) =>
    focusRef.value === it.ref && w && (dims.value = `${w}×${h}`)
  if (it.kind === 'image') {
    const img = new Image()
    img.onload = () => done(img.naturalWidth, img.naturalHeight)
    img.src = it.url
  } else {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      done(video.videoWidth, video.videoHeight)
      if (focusRef.value === it.ref && Number.isFinite(video.duration))
        dims.value += ` · ${video.duration.toFixed(1)} s`
    }
    video.src = it.url
  }
})

function onCard(it: MediaPickerItem, index: number, e: MouseEvent) {
  focusRef.value = it.ref
  if (!props.multiple) {
    picked.value = [it.ref]
    return
  }
  if (e.shiftKey && anchor >= 0) {
    const [from, to] = anchor < index ? [anchor, index] : [index, anchor]
    const range = visible.value.slice(from, to + 1).map((x) => x.ref)
    picked.value = [...picked.value, ...range.filter((r) => !picked.value.includes(r))]
  } else {
    picked.value = order(it.ref)
      ? picked.value.filter((r) => r !== it.ref)
      : [...picked.value, it.ref]
  }
  anchor = index
}
function pickNow(it: MediaPickerItem) {
  const refs =
    props.multiple && !picked.value.includes(it.ref)
      ? [...picked.value, it.ref]
      : props.multiple
        ? picked.value
        : [it.ref]
  emit('pick', refs)
  close()
}
function confirm() {
  if (!picked.value.length) return
  emit('pick', [...picked.value])
  close()
}
function close() {
  emit('update:open', false)
}

// --- uploads -------------------------------------------------------------------------------------
const ACCEPT: Record<MediaPickerKind, string> = {
  image: 'image/*',
  video: 'video/*',
  audio: 'audio/*',
}
function chooseFiles() {
  const input = document.createElement('input')
  input.type = 'file'
  input.multiple = props.multiple
  input.accept = props.kinds.map((k) => ACCEPT[k]).join(',')
  input.onchange = () => void upload(Array.from(input.files ?? []))
  input.click()
}
async function upload(files: File[]) {
  const usable = files.filter((f) => props.kinds.some((k) => f.type.startsWith(`${k}/`)))
  if (!usable.length || !props.library.upload) return
  state.value = 'loading'
  try {
    const refs = await props.library.upload(usable, props.subfolder)
    root.value = 'input'
    await load(true)
    folder.value = null
    picked.value = props.multiple
      ? [...picked.value, ...refs.filter((r) => !picked.value.includes(r))]
      : refs.slice(-1)
    focusRef.value = refs[refs.length - 1] ?? ''
    await nextTick()
    grid.reveal(visible.value.findIndex((it) => it.ref === focusRef.value))
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    state.value = 'error'
  }
}
function onDragOver(e: DragEvent) {
  if (props.library.upload && e.dataTransfer?.types.includes('Files')) dropping.value = true
}
function onDragLeave(e: DragEvent) {
  if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null))
    dropping.value = false
}
function onDrop(e: DragEvent) {
  dropping.value = false
  void upload(Array.from(e.dataTransfer?.files ?? []))
}

// --- formatting ----------------------------------------------------------------------------------
function bytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}
function date(seconds: number) {
  return seconds
    ? new Date(seconds * 1000).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : ''
}
</script>

<style scoped>
.zmp {
  position: relative;
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr) 260px;
  height: calc(100% + 28px);
  margin: -14px;
  font-size: 12px;
}
.zmp-search {
  flex: 1;
  max-width: 320px;
}
.zmp-grow {
  flex: 1;
}

/* folders */
.zmp-folders {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 8px;
  border-right: 1px solid var(--zen-border, #34343c);
}
.zmp-folder {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 5px 8px;
  border: 0;
  border-radius: var(--zen-radius, 7px);
  background: none;
  color: var(--zen-muted, #9aa0aa);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.zmp-folder:hover {
  background: color-mix(in srgb, var(--zen-text, #e5e5ea) 6%, transparent);
  color: var(--zen-text, #e5e5ea);
}
.zmp-folder.on {
  background: color-mix(in srgb, var(--zen-accent, #6366f1) 20%, transparent);
  color: var(--zen-text, #e5e5ea);
}
.zmp-folder .mdi {
  flex: none;
  font-size: 15px;
}
.zmp-fname {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.zmp-count {
  flex: none;
  color: var(--zen-muted, #9aa0aa);
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
}

/* grid */
.zmp-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.zmp-filters {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--zen-border, #34343c);
}
.zmp-grid {
  display: grid;
  flex: 1;
  align-content: start;
  gap: 10px;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
}
.zmp-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 4px;
  border: 1px solid transparent;
  border-radius: calc(var(--zen-radius, 7px) + 2px);
  background: none;
  color: var(--zen-text, #e5e5ea);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.zmp-card:hover {
  background: color-mix(in srgb, var(--zen-text, #e5e5ea) 5%, transparent);
}
.zmp-card.focus {
  border-color: var(--zen-border, #34343c);
}
.zmp-card.sel .zmp-thumb {
  outline: 2px solid var(--zen-accent, #6366f1);
  outline-offset: 1px;
}
.zmp-thumb {
  position: relative;
  display: grid;
  place-items: center;
  aspect-ratio: 1;
  overflow: hidden;
  border-radius: var(--zen-radius, 7px);
  background: #0b0b0e;
}
.zmp-thumb img,
.zmp-thumb video {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.zmp-audio {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  background: linear-gradient(
    160deg,
    color-mix(in srgb, var(--zen-accent, #6366f1) 22%, #0b0b0e),
    #0b0b0e
  );
  color: color-mix(in srgb, var(--zen-accent, #6366f1) 70%, white);
  font-size: 34px;
}
.zmp-kind {
  position: absolute;
  bottom: 5px;
  left: 5px;
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: rgb(0 0 0 / 65%);
  color: #fff;
  font-size: 13px;
}
.zmp-tick {
  position: absolute;
  top: 5px;
  right: 5px;
  display: grid;
  place-items: center;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  border-radius: 10px;
  background: var(--zen-accent, #6366f1);
  color: var(--zen-accent-text, #fff);
  font-size: 11px;
  font-weight: 700;
}
.zmp-name,
.zmp-dir {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.zmp-name {
  font-size: 11.5px;
}
.zmp-dir {
  margin-top: -3px;
  color: var(--zen-muted, #9aa0aa);
  font-size: 10.5px;
}
.zmp-empty {
  display: flex;
  flex-direction: column;
  grid-column: 1 / -1;
  align-items: center;
  gap: 6px;
  padding: 48px 12px;
  color: var(--zen-muted, #9aa0aa);
  text-align: center;
}
.zmp-empty .mdi {
  font-size: 28px;
}

/* preview */
.zmp-preview {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
  border-left: 1px solid var(--zen-border, #34343c);
}
.zmp-big {
  display: grid;
  place-items: center;
  aspect-ratio: 1;
  overflow: hidden;
  border-radius: var(--zen-radius, 7px);
  background: #0b0b0e;
}
.zmp-big img,
.zmp-big video {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.zmp-bigaudio {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px;
  color: color-mix(in srgb, var(--zen-accent, #6366f1) 70%, white);
  font-size: 48px;
}
.zmp-bigaudio audio {
  width: 100%;
}
.zmp-meta {
  display: flex;
  flex-direction: column;
  gap: 3px;
  color: var(--zen-muted, #9aa0aa);
  overflow-wrap: anywhere;
}
.zmp-meta b {
  color: var(--zen-text, #e5e5ea);
  font-size: 12.5px;
}
.zmp-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin: auto 0;
  color: var(--zen-muted, #9aa0aa);
  line-height: 1.5;
  text-align: center;
}
.zmp-hint .mdi {
  font-size: 26px;
}

/* drop + footer */
.zmp-drop {
  position: absolute;
  inset: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 2px dashed var(--zen-accent, #6366f1);
  border-radius: calc(var(--zen-radius, 7px) + 2px);
  background: color-mix(in srgb, var(--zen-accent, #6366f1) 14%, rgb(0 0 0 / 60%));
  color: var(--zen-text, #e5e5ea);
  font-size: 14px;
  font-weight: 600;
  pointer-events: none;
}
.zmp-foot {
  display: flex;
  align-items: center;
  gap: 8px;
}
.zmp-soft {
  color: var(--zen-muted, #9aa0aa);
}
</style>
