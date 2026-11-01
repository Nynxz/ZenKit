<template>
  <div class="ob">
    <div class="toolbar">
      <ZenIconButton
        :active="foldersOpen"
        icon="mdi mdi-file-tree-outline"
        :title="foldersOpen ? 'Hide folders' : 'Show folders'"
        @click="toggleFolders"
      />
      <ZenSelect
        v-if="roots.length > 1"
        class="rootsel"
        :model-value="root"
        :options="rootOptions"
        @update:model-value="(v) => setRoot(v as AssetRoot)"
      />
      <div class="search">
        <i class="mdi mdi-magnify"></i>
        <input
          v-model="filter"
          :placeholder="
            byMeaning
              ? 'describe it, or sampler:euler seed:42'
              : 'search prompts, names · sampler:euler seed:42'
          "
          title="Words match the prompt, file name, model and loras. Filters: sampler: scheduler: model: lora: seed: steps: cfg: neg: kind: ext: workflow:yes|no — a leading - excludes."
          spellcheck="false"
        />
        <button
          v-if="visual?.model"
          type="button"
          class="vis mdi"
          :class="[
            searching && byMeaning ? 'mdi-loading mdi-spin' : 'mdi-eye-outline',
            { on: byMeaning },
          ]"
          :title="
            byMeaning
              ? 'Ranking by what images show — click to match words only'
              : 'Rank by what images show (loads the embedding model)'
          "
          @click="byMeaning = !byMeaning"
        />
      </div>
      <span class="fbtn">
        <ZenIconButton
          :active="filterOpen || types.length > 0"
          icon="mdi mdi-filter-variant"
          title="Filter by type"
          @click="openFilter"
        />
        <span v-if="types.length" class="fbadge">{{ types.length }}</span>
      </span>
      <ZenIconButton
        :active="viewOpen"
        icon="mdi mdi-tune-variant"
        title="View — sort, order, card size"
        @click="openView"
      />
      <ZenIconButton
        :icon="loading ? 'mdi mdi-loading mdi-spin' : 'mdi mdi-refresh'"
        title="refresh"
        :disabled="loading"
        @click="load()"
      />
      <button
        v-if="weaker"
        type="button"
        class="more"
        :title="
          showWeaker
            ? 'Show only the close matches'
            : 'Show every file, the weaker matches ranked below the close ones'
        "
        @click="showWeaker = !showWeaker"
      >
        {{ showWeaker ? 'close matches only' : `+${weaker.toLocaleString()} more` }}
      </button>
      <span class="count">{{ filtered.length }}</span>
    </div>

    <div v-if="error" class="err">{{ error }}</div>

    <div v-if="scan" class="scanbar">
      <div class="track"><div class="fill" :style="{ width: scanPct + '%' }" /></div>
      <span class="lbl">scanning {{ scan.current }} / {{ scan.total }} ({{ scanPct }}%)</span>
    </div>

    <div class="body">
      <aside v-if="foldersOpen" class="folders zen-scroll">
        <button
          type="button"
          class="allrow"
          :class="{ on: folder === null }"
          @click="folder = null"
        >
          <i class="mdi mdi-folder-multiple-outline" />
          <span>All</span>
          <span class="n">{{ typed.length }}</span>
        </button>
        <ZenFolderTree
          v-model="folder"
          :folders="folderTree"
          :storage-key="`zensuite.assets.open.${root}`"
        />
      </aside>
      <div class="ob-scroll" ref="scrollEl" @scroll="onScroll">
        <ZenEmpty v-if="!filtered.length" class="empty">
          {{ loading ? 'scanning ' + root + '…' : 'no ' + root + ' assets found' }}
        </ZenEmpty>
        <div v-else class="ob-pad" :style="{ height: totalH + 'px' }">
          <div class="ob-grid" :style="gridStyle">
            <button
              v-for="(it, i) in visible"
              :key="it.rel"
              class="tile"
              :class="{ sel: selected && selected.rel === it.rel }"
              :title="
                DRAGGABLE.has(it.kind)
                  ? it.name +
                    ' — drag onto a node to use it as an input · hold Shift to see it large'
                  : it.name
              "
              :draggable="DRAGGABLE.has(it.kind)"
              :data-peek="VIEWABLE.has(it.kind) ? viewUrl(it, root) : undefined"
              :data-peek-kind="VIEWABLE.has(it.kind) ? it.kind : undefined"
              :data-peek-label="it.name"
              :data-peek-detail="it.subfolder || undefined"
              @click="selectItem(it)"
              @dblclick="openAt(startRow * cols + i)"
              @dragstart="onDragStart($event, it)"
              @contextmenu.prevent="openMenu($event, it, startRow * cols + i)"
            >
              <div class="img">
                <!-- videos too: the server serves their first frame as a cached JPEG, so the grid
                     never holds a <video> (each one is a decoder) -->
                <img
                  v-if="it.kind === 'image' || it.kind === 'video'"
                  :src="thumbUrl(root, it.rel, 256, it.mtime)"
                  draggable="false"
                  decoding="async"
                  alt=""
                />
                <i v-else-if="it.kind === 'audio'" class="mdi mdi-music-note vid"></i>
                <i v-else-if="it.kind === 'model3d'" class="mdi mdi-cube-outline vid"></i>
                <i v-else class="mdi mdi-file-outline vid"></i>
                <span v-if="it.kind === 'video'" class="kbadge">
                  <i class="mdi mdi-play-circle"></i>
                </span>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- hold Shift over a tile to see it large -->
    <ZenPeek />

    <!-- type filter: none ticked shows every type -->
    <ZenPopover v-model:open="filterOpen" :anchor="filterAnchor" placement="bottom-end">
      <div class="vm">
        <div class="vm-h">Type</div>
        <ZenCheckbox
          v-for="k in KINDS"
          :key="k.kind"
          :model-value="types.includes(k.kind)"
          :disabled="!kindCount[k.kind] && !types.includes(k.kind)"
          :label="`${k.label} · ${kindCount[k.kind] ?? 0}`"
          @update:model-value="(on: boolean) => toggleType(k.kind, on)"
        />
        <ZenMenuItem v-if="types.length" icon="mdi mdi-filter-remove-outline" @select="types = []">
          Show every type
        </ZenMenuItem>
      </div>
    </ZenPopover>

    <!-- view menu (sort / order / card size) -->
    <ZenPopover v-model:open="viewOpen" :anchor="viewAnchor" placement="bottom-end">
      <div class="vm">
        <div class="vm-h">Sort</div>
        <ZenToggleGroup
          :model-value="sortKey"
          :options="sortTg"
          @update:model-value="(v) => pickSort(v as SortKey)"
        />
        <div class="vm-h">Order</div>
        <ZenToggleGroup
          :model-value="asc ? 'asc' : 'desc'"
          :options="orderTg"
          @update:model-value="(v) => (asc = v === 'asc')"
        />
        <div class="vm-h">Card size</div>
        <ZenSlider
          :model-value="cardW"
          :min="80"
          :max="320"
          :step="20"
          @update:model-value="(v) => setCardW(v as number)"
        />
        <div class="vm-h">Visual search</div>
        <ZenSelect
          :model-value="visual?.model ?? ''"
          :options="visualOptions"
          :disabled="!visual?.models.length"
          @update:model-value="(v) => pickVisual(v as string)"
        />
        <p class="vm-note">{{ visualLine }}</p>
        <ZenButton
          v-if="visual?.model && (visual.pending || visualIndexing)"
          sm
          :icon="visualIndexing ? 'mdi mdi-loading mdi-spin' : 'mdi mdi-database-arrow-up-outline'"
          :disabled="visualIndexing"
          @click="startIndex"
        >
          {{ visualIndexing ? 'Indexing…' : `Index ${visual.pending.toLocaleString()} files` }}
        </ZenButton>
      </div>
    </ZenPopover>

    <!-- right-click context menu -->
    <ZenPopover v-model:open="ctxOpen" :anchor="ctxAt" placement="bottom-start">
      <ZenMenuItem icon="mdi mdi-fullscreen" @select="openSelectedThenClose()">
        Open in lightbox
      </ZenMenuItem>
      <ZenMenuItem icon="mdi mdi-image-multiple-outline" @select="ctxItem && openInViewer(ctxItem)">
        Open in viewer
      </ZenMenuItem>
      <ZenMenuItem
        v-if="canLoadWorkflow(ctxItem)"
        icon="mdi mdi-sitemap-outline"
        @select="ctxItem && loadWorkflow(ctxItem)"
      >
        Load workflow
      </ZenMenuItem>
      <ZenMenuItem icon="mdi mdi-open-in-new" @select="ctxItem && openNewTab(ctxItem)">
        Open in new tab
      </ZenMenuItem>
    </ZenPopover>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  ZenSelect,
  ZenToggleGroup,
  ZenSlider,
  ZenIconButton,
  ZenPopover,
  ZenMenuItem,
  ZenEmpty,
  ZenButton,
  ZenCheckbox,
  ZenFolderTree,
  ZenPeek,
  type FolderTreeEntry,
} from '@nynxz/zenkit-ui'
import { setMediaDragData, openViewer, useJob, type ViewerItem } from '@nynxz/zenkit-client'
import { app } from '@comfy/app'
import {
  listAssets,
  listRoots,
  indexVisual,
  searchAssets,
  setVisualModel,
  visualStatus,
  thumbUrl,
  viewUrl,
  type AssetItem,
  type AssetRoot,
  type RootInfo,
  type VisualStatus,
} from '../lib/api'
import { watchOutputs, type LiveOutput } from '../lib/liveAssets'

// Drag a tile onto the ComfyUI graph. Everything we list already lives in ComfyUI's
// output/input/temp, so we pass `type`/`subfolder` — dropping on a loader node then points
// its widget at the existing file rather than re-uploading a duplicate into input/.
function onDragStart(e: DragEvent, it: AssetItem) {
  if (!DRAGGABLE.has(it.kind)) return
  const img = (e.currentTarget as HTMLElement | null)?.querySelector(
    'img',
  ) as HTMLImageElement | null
  setMediaDragData(
    e,
    {
      url: viewUrl(it, root.value),
      filename: it.name,
      subfolder: it.subfolder,
      type: root.value, // 'output' | 'input' | 'temp' — already ComfyUI's ResultItem type
      hasWorkflow: it.has_workflow,
    },
    img,
  )
}

// Kinds worth dragging: ComfyUI's loader nodes (LoadImage / LoadAudio / LoadVideo) all
// accept the same asset drop. 'other' has no loader to land on, so it stays inert.
const DRAGGABLE = new Set<AssetItem['kind']>(['image', 'video', 'audio'])

const SORTS = [
  { key: 'mtime', label: 'date' },
  { key: 'name', label: 'name' },
  { key: 'size', label: 'size' },
  { key: 'match', label: 'match' },
] as const
type SortKey = (typeof SORTS)[number]['key']

const ROOT_LABEL: Record<string, string> = { output: 'Outputs', input: 'Inputs', temp: 'Temp' }
const ROOT_ICON: Record<string, string> = {
  output: 'mdi-image-multiple',
  input: 'mdi-folder-image',
  temp: 'mdi-clock-outline',
}

const rootOptions = computed(() =>
  roots.value.map((r) => ({
    value: r.name,
    label: ROOT_LABEL[r.name] || r.name,
    icon: 'mdi ' + (ROOT_ICON[r.name] || 'mdi-folder-outline'),
    title: r.dir,
  })),
)
// View-menu controls, built from real ZenKit components (ZenToggleGroup / ZenSlider).
// 'match' (best first) only means something while visual search ranks a search.
const sortTg = computed(() =>
  SORTS.filter((s) => s.key !== 'match' || ranked.value).map((s) => ({
    value: s.key,
    label: s.label,
  })),
)
const orderTg = [
  { value: 'asc', label: 'asc', icon: 'mdi mdi-arrow-up' },
  { value: 'desc', label: 'desc', icon: 'mdi mdi-arrow-down' },
]

const roots = ref<RootInfo[]>([])
const root = ref<AssetRoot>('output')
const items = ref<AssetItem[]>([])
const loading = ref(false)
const error = ref('')
const filter = ref('')
const sortKey = ref<SortKey>('mtime')
const asc = ref(false)

// virtualized grid (port of the ZenTensors pattern): only visible rows render.
const GAP = 8
const CHROME = 0 // image fills the tile edge-to-edge → tile height == width (square); the 1px
// border is inside (border-box) and GAP separates tiles. No extra chrome.
/** Rows render in blocks of this many, one spare block either side, and the slice moves a block
 *  at a time: tiles change every few rows scrolled rather than at every row, and each change
 *  restyles the page, which on ComfyUI's page is what made scrolling stutter. */
const BLOCK = 3
const cardW = ref(120) // min card width; cards grow to fill the row
const scrollEl = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const containerW = ref(600)
const viewportH = ref(600)
let ro: ResizeObserver | null = null
function onScroll() {
  if (scrollEl.value) scrollTop.value = scrollEl.value.scrollTop
}
function measure() {
  if (scrollEl.value) {
    containerW.value = scrollEl.value.clientWidth
    viewportH.value = scrollEl.value.clientHeight
  }
}

// Selection (highlight only).
const selected = ref<AssetItem | null>(null)

// Live scan progress for the current root (the server's zenkit.job events). The
// background reconcile after a generation runs the same scan, so gate the bar on
// `silentScan` — otherwise it would flash on every single generation.
const scanRaw = useJob((job) => job.id === `zensuite:scan:${root.value}`)
const silentScan = ref(false)
const scan = computed(() => (silentScan.value ? null : scanRaw.value))
const scanPct = computed(() => {
  const s = scan.value
  return s && s.total ? Math.min(100, Math.round((s.current / s.total) * 100)) : 0
})
onBeforeUnmount(() => {
  stopOutputs?.()
  if (reconcileTimer) clearTimeout(reconcileTimer)
  ro?.disconnect()
  clearTimeout(visualTimer)
})

// --- type filter and folders -----------------------------------------------
const KINDS: { kind: AssetItem['kind']; label: string }[] = [
  { kind: 'image', label: 'Images' },
  { kind: 'video', label: 'Videos' },
  { kind: 'audio', label: 'Audio' },
  { kind: 'model3d', label: '3D' },
  { kind: 'other', label: 'Other' },
]
function remembered<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}
function remember(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // a remembered view is a convenience
  }
}
/** The types shown; none means every type. */
const types = ref<AssetItem['kind'][]>(remembered('zensuite.assets.types', []))
watch(types, (v) => remember('zensuite.assets.types', v))
function toggleType(kind: AssetItem['kind'], on: boolean) {
  types.value = on ? [...types.value, kind] : types.value.filter((k) => k !== kind)
}
const filterOpen = ref(false)
const filterAnchor = ref<HTMLElement | null>(null)
function openFilter(e: MouseEvent) {
  filterAnchor.value = e.currentTarget as HTMLElement
  filterOpen.value = !filterOpen.value
}
const foldersOpen = ref<boolean>(remembered('zensuite.assets.folders', false))
function toggleFolders() {
  foldersOpen.value = !foldersOpen.value
  remember('zensuite.assets.folders', foldersOpen.value)
  nextTick(remeasure)
}
/** The folder shown (with everything under it); null is every folder. */
const folder = ref<string | null>(null)

const inFolder = (it: AssetItem) =>
  folder.value === null ||
  it.subfolder === folder.value ||
  it.subfolder.startsWith(folder.value + '/')
/** In the folder, before the type filter: what the type counts are of. */
const foldered = computed(() => items.value.filter(inFolder))
const kindCount = computed(() => {
  const n: Partial<Record<AssetItem['kind'], number>> = {}
  for (const it of foldered.value) n[it.kind] = (n[it.kind] ?? 0) + 1
  return n
})
/** Every folder, counting the files of the shown types anywhere inside it. */
const typed = computed(() =>
  types.value.length ? items.value.filter((i) => types.value.includes(i.kind)) : items.value,
)
const folderTree = computed<FolderTreeEntry[]>(() => {
  const n = new Map<string, number>()
  for (const it of typed.value) {
    if (!it.subfolder) continue
    const parts = it.subfolder.split('/')
    for (let i = 1; i <= parts.length; i++) {
      const path = parts.slice(0, i).join('/')
      n.set(path, (n.get(path) ?? 0) + 1)
    }
  }
  // The picked folder stays in the tree when the type filter empties it, so it can be seen and left.
  if (folder.value && !n.has(folder.value)) n.set(folder.value, 0)
  return [...n].sort((a, b) => a[0].localeCompare(b[0])).map(([path, count]) => ({ path, count }))
})

/** In the folder and of the picked types: what the search narrows. */
const typedInFolder = computed(() =>
  types.value.length ? foldered.value.filter((i) => types.value.includes(i.kind)) : foldered.value,
)
/** Ranked results past the close matches, hidden until asked for. */
const weaker = computed(() => {
  const hit = matches.value
  if (!hit || !ranked.value || !filter.value.trim()) return 0
  return typedInFolder.value.filter((i) => (hit.get(i.rel) ?? -1) >= closeCount.value).length
})
const filtered = computed(() => {
  const f = filter.value.trim().toLowerCase()
  const shown = typedInFolder.value
  // The server's matches once they arrive; the name alone while they are on their way.
  const hit = matches.value
  const limit = ranked.value && !showWeaker.value ? closeCount.value : Infinity
  const list = !f
    ? shown.slice()
    : hit
      ? shown.filter((i) => (hit.get(i.rel) ?? Infinity) < limit)
      : shown.filter((i) => i.rel.toLowerCase().includes(f))
  const dir = asc.value ? 1 : -1
  if (sortKey.value === 'match' && hit && ranked.value)
    return list.sort((a, b) => hit.get(a.rel)! - hit.get(b.rel)!)
  list.sort((a, b) => {
    if (sortKey.value === 'name') return a.name.localeCompare(b.name) * dir
    if (sortKey.value === 'size') return (a.size - b.size) * dir
    return (a.mtime - b.mtime) * dir
  })
  return list
})
// The grid lays out INSIDE .ob-scroll's padding, so the usable width is clientWidth minus
// that padding. Measuring clientWidth directly made the derived tile HEIGHT larger than the
// real 1fr column WIDTH (by ~16/cols px) → a gap under square images.
const PAD = 8 // keep in sync with .ob-scroll horizontal padding
const availW = computed(() => Math.max(0, containerW.value - PAD * 2))
const cols = computed(() => Math.max(1, Math.floor((availW.value + GAP) / (cardW.value + GAP))))
// Exact, UN-rounded column width. `1fr` columns render to precisely this, so tying the tile
// height to the SAME number makes every tile pixel-perfectly square (no rounding gap).
const cellW = computed(() => Math.max(48, (availW.value - (cols.value - 1) * GAP) / cols.value))
const rowH = computed(() => cellW.value + CHROME + GAP)
const totalRows = computed(() => Math.ceil(filtered.value.length / cols.value))
const totalH = computed(() => Math.max(0, totalRows.value * rowH.value - GAP))
const startRow = computed(() => {
  const first = Math.floor(scrollTop.value / rowH.value)
  return Math.max(0, (Math.floor(first / BLOCK) - 1) * BLOCK)
})
const endRow = computed(() => {
  const last = Math.ceil((scrollTop.value + viewportH.value) / rowH.value)
  return Math.min(totalRows.value, (Math.ceil(last / BLOCK) + 1) * BLOCK)
})
const visible = computed(() =>
  filtered.value.slice(startRow.value * cols.value, endRow.value * cols.value),
)
const gridStyle = computed(() => ({
  '--obrow': cellW.value + CHROME + 'px',
  gridTemplateColumns: `repeat(${cols.value}, 1fr)`,
  gap: GAP + 'px',
  transform: `translateY(${startRow.value * rowH.value}px)`,
}))

// Lightbox items mirror the (sorted/filtered) grid order; images use the full
// /view file so zoom is crisp, videos stream from /view too.
const VIEWABLE = new Set<AssetItem['kind']>(['image', 'video', 'audio'])
const viewable = computed(() => filtered.value.filter((it) => VIEWABLE.has(it.kind)))
const lbItems = computed<ViewerItem[]>(() =>
  viewable.value.map((it) => ({
    src: viewUrl(it, root.value),
    kind: it.kind === 'video' ? 'video' : it.kind === 'audio' ? 'audio' : 'image',
    label: it.name,
    meta: it.subfolder || '',
    onWorkflow: canLoadWorkflow(it) ? () => loadWorkflow(it) : undefined,
  })),
)

// The search runs on the server, over the metadata index (prompts, samplers, models…).
/** rel -> its place in the server's order. */
const matches = ref<Map<string, number> | null>(null)
const ranked = ref(false)
const closeCount = ref(0)
const showWeaker = ref(false)
/** The sort to go back to when a ranked search ends. */
let sortBeforeMatch: SortKey | null = null
function setRanked(on: boolean) {
  ranked.value = on
  if (on && sortKey.value !== 'match' && sortBeforeMatch === null) {
    sortBeforeMatch = sortKey.value
    sortKey.value = 'match'
  } else if (!on) {
    if (sortKey.value === 'match') sortKey.value = sortBeforeMatch ?? 'mtime'
    sortBeforeMatch = null
  }
}
/** Rank searches by what images show: off until clicked, as it loads the embedding model. */
const byMeaning = ref(false)
const searching = ref(false)
let searchTimer: ReturnType<typeof setTimeout> | undefined
let searchSeq = 0
function runSearch() {
  clearTimeout(searchTimer)
  const q = filter.value.trim()
  const seq = ++searchSeq
  if (!q) {
    matches.value = null
    setRanked(false)
    return
  }
  searchTimer = setTimeout(async () => {
    searching.value = true
    try {
      const r = await searchAssets(root.value, q, byMeaning.value)
      if (seq !== searchSeq) return
      matches.value = new Map(r.rels.map((rel, i) => [rel, i]))
      closeCount.value = r.close
      setRanked(r.visual === 'ranked')
      visualBusy.value = r.visual === 'busy'
    } catch {
      if (seq === searchSeq) matches.value = null
    } finally {
      if (seq === searchSeq) searching.value = false
    }
  }, 250)
}
// Keep the last matches while the next search runs, so typing doesn't flicker the grid.
watch(root, () => (matches.value = null))
watch([filter, root, byMeaning], runSearch)
watch([filter, root], () => (showWeaker.value = false))
// New files (a finished run, a rescan) may match too.
watch(
  () => items.value.length,
  () => filter.value.trim() && runSearch(),
)

watch([filter, sortKey, asc, types, folder], () => {
  if (scrollEl.value) scrollEl.value.scrollTop = 0
  scrollTop.value = 0
})

function pickSort(k: SortKey) {
  sortKey.value = k
  sortBeforeMatch = null // picked by hand: keep it after the search
}

// --- visual search: the embedding model and how far its index has got ---
const visual = ref<VisualStatus | null>(null)
const visualBusy = ref(false)
const visualIndexing = computed(() =>
  ['loading', 'indexing', 'paused'].includes(visual.value?.state ?? ''),
)
const visualOptions = computed(() => [
  { value: '', label: 'Off' },
  ...(visual.value?.models ?? []).map((m) => ({
    value: m,
    label: m.replace(/\.(safetensors|sft)$/, ''),
  })),
])
const visualLine = computed(() => {
  const v = visual.value
  if (!v) return ''
  if (!v.models.length)
    return 'Put a Qwen3-VL-Embedding model in models/embedders to search by what images show.'
  if (!v.model) return 'Off: searches match words only.'
  const count = `${v.done.toLocaleString()} of ${v.total.toLocaleString()}`
  if (v.state === 'error') return `Indexing failed: ${v.error}`
  if (v.state === 'loading') return 'Starting…'
  if (v.state === 'paused') return `Indexed ${count} · paused while a workflow runs`
  if (v.state === 'indexing') return `Indexing ${count}…`
  if (visualBusy.value) return 'Ranking pauses while a workflow runs.'
  const indexed = `${v.done.toLocaleString()} indexed`
  return v.pending
    ? `${indexed}, ${v.pending.toLocaleString()} not yet. The eye in the search box ranks by what images show.`
    : `${indexed}. The eye in the search box ranks by what images show.`
})
let visualTimer: ReturnType<typeof setTimeout> | undefined
async function refreshVisual() {
  clearTimeout(visualTimer)
  try {
    visual.value = await visualStatus()
  } catch {
    return
  }
  // Follow the index while it builds, or while the menu shows it.
  if (visualIndexing.value || viewOpen.value) visualTimer = setTimeout(refreshVisual, 2000)
}
async function pickVisual(model: string) {
  visual.value = await setVisualModel(model || null)
  if (!model) byMeaning.value = false
  else if (byMeaning.value && filter.value.trim()) runSearch()
}
async function startIndex() {
  try {
    visual.value = await indexVisual()
  } catch {
    return
  }
  void refreshVisual()
}

// View menu — controlled ZenPopover anchored to the ⚙ button (its own element from the click).
const viewOpen = ref(false)
const viewAnchor = ref<HTMLElement | null>(null)
function openView(e: MouseEvent) {
  viewAnchor.value = e.currentTarget as HTMLElement
  viewOpen.value = !viewOpen.value
}
watch(viewOpen, (open) => open && refreshVisual())
function setRoot(r: AssetRoot) {
  if (root.value === r) return
  root.value = r
  folder.value = null
  if (scrollEl.value) scrollEl.value.scrollTop = 0
  scrollTop.value = 0
  selected.value = null
  load()
}
/** Opens the grid's i-th file: in the shared viewer, or in a new tab for what it can't show (3D). */
function openAt(i: number) {
  const it = filtered.value[i]
  if (!it) return
  if (!VIEWABLE.has(it.kind)) return void window.open(viewUrl(it, root.value), '_blank')
  openViewer(lbItems.value, { index: viewable.value.indexOf(it) })
}

// right-click context menu — a ZenPopover anchored at the cursor point.
const ctxOpen = ref(false)
const ctxAt = ref<{ x: number; y: number }>({ x: 0, y: 0 })
const ctxItem = ref<AssetItem | null>(null)
const ctxIndex = ref(-1)
function openMenu(e: MouseEvent, it: AssetItem, index: number) {
  ctxAt.value = { x: e.clientX, y: e.clientY }
  ctxItem.value = it
  ctxIndex.value = index
  ctxOpen.value = true
}
function closeMenu() {
  ctxOpen.value = false
}
function openNewTab(it: AssetItem) {
  window.open(viewUrl(it, root.value), '_blank')
  closeMenu()
}
// Show the asset in the Media Viewer: publish it to a channel (the viewer's
// default "$last" picks it up), opening a viewer panel if none is open yet.
function openInViewer(it: AssetItem) {
  closeMenu()
  const zen = (
    window as unknown as {
      ZenKit?: {
        channels?: {
          publish?: (
            c: string,
            i: {
              url: string
              filename?: string
              label?: string
              kind?: 'image' | 'video' | 'audio'
            },
          ) => void
        }
        panels?: {
          instances?: (id: string) => unknown[]
          registered?: () => { id: string; open?: () => void }[]
        }
      }
    }
  ).ZenKit
  if (!zen) return
  const kind = it.kind === 'video' ? 'video' : it.kind === 'audio' ? 'audio' : 'image'
  zen.channels?.publish?.('assets', {
    url: viewUrl(it, root.value),
    filename: it.name,
    label: it.name,
    kind,
  })
  if (!zen.panels?.instances?.('zensuite:viewer')?.length) {
    zen.panels
      ?.registered?.()
      .find((r) => r.id === 'zensuite:viewer')
      ?.open?.()
  }
}
// Containers ComfyUI's own getWorkflowDataFromFile() can pull a workflow out of:
// video/webm via getFromWebmFile, and mp4/mov/m4v via getFromIsobmffFile. Deliberately
// NOT .mkv/.avi — ComfyUI has no extractor for those, so offering it would just fail.
// Containers ComfyUI can extract a workflow from, mapped to the MIME its branch tests for.
// Keys are dotless: the index sends `ext.lstrip(".")`. We set the type rather than trusting
// the blob's — webm is matched by MIME alone, and /view derives it from the host's mime db.
const WORKFLOW_VIDEO_MIME: Record<string, string> = {
  webm: 'video/webm',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  m4v: 'video/mp4',
}

/** Offer "Load workflow" when we know there is one, or when ComfyUI could extract one. */
function canLoadWorkflow(it: AssetItem | null | undefined): boolean {
  if (!it) return false
  if (it.has_workflow) return true
  return it.kind === 'video' && it.ext.toLowerCase() in WORKFLOW_VIDEO_MIME
}

// Hand the file to ComfyUI, which extracts the embedded workflow (images, webm, mp4/mov/m4v).
async function loadWorkflow(it: AssetItem) {
  closeMenu()
  try {
    const res = await fetch(viewUrl(it, root.value))
    const blob = await res.blob()
    const type = WORKFLOW_VIDEO_MIME[it.ext.toLowerCase()] || blob.type
    await (app as unknown as { handleFile: (f: File) => Promise<void> | void }).handleFile(
      new File([blob], it.name, { type }),
    )
  } catch (err) {
    console.warn('[ZenKit] load workflow failed', err)
  }
}

function selectItem(it: AssetItem) {
  selected.value = it // highlight only
}

// --- live updates -----------------------------------------------------------
// A finished generation shows up straight away: the `executed` event carries
// enough to build a tile (the /zensuite/thumb route renders on demand), then a
// debounced, silent rescan fills in the fields only the server can know — size,
// embedded workflow, node count, real mtime.

const RECONCILE_MS = 400
// How long an optimistic tile survives without the scan confirming it. The file
// can land a beat after the event, so a reconcile that misses it must not blink
// the tile out; past this it was a phantom (wrong root, deleted, never written).
const OPTIMISTIC_TTL_MS = 15000

let stopOutputs: (() => void) | undefined
let reconcileTimer: ReturnType<typeof setTimeout> | undefined
const optimistic = new Map<string, number>() // rel -> inserted at (ms)

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toLowerCase() : ''
}

function optimisticItem(o: LiveOutput): AssetItem {
  const sub = o.subfolder || ''
  return {
    // Matches the backend's posix `rel` (os.sep is normalised to '/' there), so
    // the reconcile dedupes cleanly instead of producing a twin tile.
    rel: sub ? `${sub}/${o.filename}` : o.filename,
    name: o.filename,
    subfolder: sub,
    ext: extOf(o.filename),
    kind: o.kind,
    mtime: Date.now() / 1000, // backend mtime is epoch SECONDS; reconcile corrects it
    size: 0,
    has_workflow: false,
    node_count: 0,
  }
}

// Keep the viewport steady across a list change, whatever the current sort is:
// remember the item at the top of the view, then put it back where it was. A
// row-count delta wouldn't work — new items only land at the top under date-desc.
function anchorScroll(mutate: () => void) {
  const el = scrollEl.value
  if (!el) {
    mutate()
    return
  }
  // At the top, let new tiles simply come into view — that's the point.
  if (el.scrollTop <= 1) {
    mutate()
    return
  }
  const rowBefore = rowH.value
  const row = Math.floor(el.scrollTop / rowBefore)
  const anchorRel = filtered.value[row * cols.value]?.rel
  // As a FRACTION of the row, not raw px: a geometry change (resize, card-size) alters rowH,
  // and a px offset measured against the old row height would drift. For a plain list change
  // rowH is unchanged, so this is identical to the offset it replaces.
  const withinFrac = rowBefore > 0 ? (el.scrollTop - row * rowBefore) / rowBefore : 0
  mutate()
  if (!anchorRel) return
  nextTick(() => {
    const el2 = scrollEl.value
    const i = filtered.value.findIndex((f) => f.rel === anchorRel)
    if (i < 0 || !el2) return
    const top = (Math.floor(i / cols.value) + withinFrac) * rowH.value
    // The list may now be shorter than the anchor's old position allows.
    const max = Math.max(0, el2.scrollHeight - el2.clientHeight)
    const next = Math.min(Math.max(0, top), max)
    el2.scrollTop = next
    scrollTop.value = next
  })
}

// Geometry changes move every row: resizing the panel (or a ZenKit dock resizing the workspace)
// changes the column count, and the card-size slider changes the row height. Either way the tile
// you were looking at slides away under a scrollTop that now means something else. Route both
// through anchorScroll so the tile at the top of the view stays at the top of the view.
function remeasure() {
  anchorScroll(measure)
}
function setCardW(v: number) {
  anchorScroll(() => {
    cardW.value = v
  })
}

function onLiveOutputs(outs: LiveOutput[]) {
  const mine = outs.filter((o) => o.type === root.value)
  if (!mine.length) return
  const known = new Set(items.value.map((i) => i.rel))
  const fresh = mine.map(optimisticItem).filter((i) => !known.has(i.rel))
  if (fresh.length) {
    const now = Date.now()
    for (const f of fresh) optimistic.set(f.rel, now)
    anchorScroll(() => {
      items.value = [...fresh, ...items.value]
    })
  }
  // One reconcile per burst — a batch of 8 images fires 8 `executed` events.
  if (reconcileTimer) clearTimeout(reconcileTimer)
  reconcileTimer = setTimeout(() => load({ silent: true }), RECONCILE_MS)
}

// Merge a server listing over the current list, preserving optimistic tiles the
// scan hasn't picked up yet so they don't flicker out and back in.
function mergeServerItems(server: AssetItem[]): AssetItem[] {
  const byRel = new Set(server.map((i) => i.rel))
  const now = Date.now()
  const pending: AssetItem[] = []
  for (const [rel, at] of [...optimistic]) {
    if (byRel.has(rel) || now - at > OPTIMISTIC_TTL_MS) {
      optimistic.delete(rel)
      continue
    }
    const it = items.value.find((i) => i.rel === rel)
    if (it) pending.push(it)
  }
  return pending.length ? [...pending, ...server] : server
}

async function load(opts: { silent?: boolean } = {}) {
  const silent = !!opts.silent
  // A silent reconcile must not take over the toolbar spinner, the error line or
  // the scan bar — it's a background top-up, not something the user asked for.
  if (!silent) loading.value = true
  else silentScan.value = true
  if (!silent) error.value = ''
  try {
    const r = await listAssets(root.value)
    if (r.error) {
      if (!silent) error.value = r.error
    } else {
      const next = r.items || []
      if (silent)
        anchorScroll(() => {
          items.value = mergeServerItems(next)
        })
      else {
        optimistic.clear()
        items.value = next
      }
    }
  } catch (e: unknown) {
    if (!silent) error.value = String((e as Error)?.message || e)
  } finally {
    if (!silent) loading.value = false
    else silentScan.value = false
  }
}

onMounted(async () => {
  const all = await listRoots()
  roots.value = all.filter((r) => r.exists)
  if (roots.value.length && !roots.value.some((r) => r.name === root.value)) {
    root.value = roots.value[0].name
  }
  load()
  measure()
  void refreshVisual()
  stopOutputs = watchOutputs(onLiveOutputs)
  if (typeof ResizeObserver !== 'undefined' && scrollEl.value) {
    ro = new ResizeObserver(() => remeasure())
    ro.observe(scrollEl.value)
  }
})
// Named rather than inlined in the template: Prettier's `semi: false` strips the separator from a
// multi-statement inline handler, and Vue cannot parse newline-separated statements there.
function openSelectedThenClose() {
  openAt(ctxIndex.value)
  closeMenu()
}
</script>

<style scoped>
.ob {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
  font-family: var(--p-font-family, system-ui, sans-serif);
  color: var(--zen-text, var(--input-text, #e5e5ea));
  background: var(--zen-bg, var(--comfy-menu-bg, #1a1a1f));
}
.toolbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-bottom: 1px solid var(--zen-border, #3a3a44);
  flex-wrap: wrap;
}
.search {
  flex: 1;
  min-width: 120px;
  display: flex;
  align-items: center;
  gap: 5px;
  background: var(--zen-input, #15151a);
  border: 1px solid var(--zen-border, #3a3a44);
  border-radius: var(--zen-radius, 6px);
  padding: 4px 8px;
}
.search .mdi {
  color: var(--zen-muted, #9aa0aa);
}
.search input {
  flex: 1;
  min-width: 0;
  background: none;
  border: none;
  color: var(--zen-text, #e5e5ea);
  font-size: 12px;
  font-family: inherit;
}
.search input:focus {
  outline: none;
}
.grow {
  flex: 1;
}
.more {
  flex: 0 0 auto;
  padding: 2px 8px;
  border: 1px solid var(--zen-control-border, var(--zen-border));
  border-radius: 999px;
  background: none;
  color: var(--zen-muted, #9aa0aa);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.more:hover {
  color: var(--zen-text);
  border-color: var(--zen-accent);
}
.count {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--zen-muted, #9aa0aa);
}
.rootsel {
  flex: 0 0 auto;
}

/* View-menu content (inside a ZenPopover, which owns the box/teleport/dismiss) */
.vm {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 200px;
}
.vm-h {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--zen-muted, #9aa0aa);
  margin-top: 3px;
}
.vm-note {
  max-width: 220px;
  margin: 0;
  color: var(--zen-muted, #9aa0aa);
  font-size: 11px;
  line-height: 1.4;
}
.search .vis {
  padding: 0;
  border: none;
  background: none;
  color: var(--zen-muted, #9aa0aa);
  font-size: 14px;
  cursor: pointer;
}
.search .vis:hover,
.search .vis.on {
  color: var(--zen-accent);
}
.vm-h:first-child {
  margin-top: 0;
}
.vm :deep(.zen-tg) {
  display: flex;
}
.vm :deep(.zen-tg-b) {
  flex: 1;
  justify-content: center;
}
.err {
  flex: 0 0 auto;
  color: var(--zen-danger);
  font-size: 11px;
  padding: 6px 8px;
}
.scanbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--zen-border, #3a3a44);
}
.scanbar .track {
  flex: 1;
  height: 5px;
  border-radius: 3px;
  overflow: hidden;
  background: var(--zen-input, #15151a);
}
.scanbar .fill {
  height: 100%;
  background: var(--zen-accent, #3b82f6);
  border-radius: 3px;
  transition: width 0.12s linear;
}
.scanbar .lbl {
  font-size: 10.5px;
  color: var(--zen-muted, #9aa0aa);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.body {
  flex: 1;
  min-height: 0;
  display: flex;
}
.folders {
  flex: 0 0 200px;
  min-width: 0;
  overflow-y: auto;
  padding: 6px 4px;
  border-right: 1px solid var(--zen-border, #3a3a44);
}
.allrow {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 3px 6px;
  border: 0;
  border-radius: var(--zen-radius-sm, 4px);
  background: none;
  color: inherit;
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.allrow:hover {
  background: var(--zen-hover, rgb(255 255 255 / 6%));
}
.allrow.on {
  background: var(
    --zen-accent-soft,
    color-mix(in srgb, var(--zen-accent, #6366f1) 22%, transparent)
  );
}
.allrow .n {
  margin-left: auto;
  color: var(--zen-muted, #9aa0aa);
  font-size: 11px;
}
.fbtn {
  position: relative;
  display: inline-flex;
}
.fbadge {
  position: absolute;
  top: -3px;
  right: -3px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: 7px;
  background: var(--zen-accent, #6366f1);
  color: var(--zen-accent-text, #fff);
  font-size: 9px;
  font-weight: 700;
  line-height: 14px;
  text-align: center;
  pointer-events: none;
}
.ob-scroll {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 8px;
  /* tiles come and go as it scrolls; anchoring would answer each change by moving the scroll */
  overflow-anchor: none;
  /* its own compositor layer: without it, Chrome repainted the grid and re-layered the whole
     page at every scroll step, which on ComfyUI's page took longer than a frame */
  will-change: scroll-position;
}
.ob-pad {
  position: relative;
  width: 100%;
}
.ob-grid {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: grid;
  align-content: start; /* columns + gap + --obth + translateY set inline */
}
.tile {
  box-sizing: border-box;
  height: var(--obrow, 140px);
  overflow: hidden;
  display: flex;
  padding: 0;
  cursor: pointer;
  text-align: left;
  background: var(--zen-input, #15151a);
  border: 1px solid var(--zen-border, #3a3a44);
  border-radius: var(--zen-radius, 8px);
  font-family: inherit;
}
.tile:hover {
  border-color: var(--zen-accent, #3b82f6);
}
.tile.sel {
  border-color: var(--zen-accent, #3b82f6);
  box-shadow: 0 0 0 1px var(--zen-accent, #3b82f6) inset;
}
.img {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--zen-bg, #15151a);
  display: flex;
  align-items: center;
  justify-content: center;
}
.img img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
.vid {
  font-size: 30px;
  color: var(--zen-muted, #9aa0aa);
}
.kbadge {
  position: absolute;
  top: 4px;
  left: 4px;
  display: inline-flex;
  color: #fff;
  font-size: 15px;
  line-height: 1;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.85);
  pointer-events: none;
}
.empty {
  min-height: 240px;
}
</style>
