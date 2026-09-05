<template>
  <div class="ob">
    <div class="toolbar">
      <ZenSelect
        v-if="roots.length > 1"
        class="rootsel"
        :model-value="root"
        :options="rootOptions"
        @update:model-value="(v) => setRoot(v as AssetRoot)"
      />
      <div class="search">
        <i class="mdi mdi-magnify"></i>
        <input v-model="filter" placeholder="filter…" spellcheck="false" />
      </div>
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
      <span class="count">{{ filtered.length }}</span>
    </div>

    <div v-if="error" class="err">{{ error }}</div>

    <div v-if="scan" class="scanbar">
      <div class="track"><div class="fill" :style="{ width: scanPct + '%' }" /></div>
      <span class="lbl">scanning {{ scan.current }} / {{ scan.total }} ({{ scanPct }}%)</span>
    </div>

    <div class="body">
      <div class="ob-scroll" ref="scrollEl" @scroll="onScroll">
        <div v-if="!filtered.length" class="empty">
          <i class="mdi mdi-image-multiple-outline"></i>
          <p>{{ loading ? 'scanning ' + root + '…' : 'no ' + root + ' assets found' }}</p>
        </div>
        <div v-else class="ob-pad" :style="{ height: totalH + 'px' }">
          <div class="ob-grid" :style="gridStyle">
            <button
              v-for="(it, i) in visible"
              :key="it.rel"
              class="tile"
              :class="{ sel: selected && selected.rel === it.rel }"
              :title="
                DRAGGABLE.has(it.kind)
                  ? it.name + ' — drag onto a node to use it as an input'
                  : it.name
              "
              :draggable="DRAGGABLE.has(it.kind)"
              @click="selectItem(it)"
              @dblclick="openAt(startRow * cols + i)"
              @dragstart="onDragStart($event, it)"
              @contextmenu.prevent="openMenu($event, it, startRow * cols + i)"
            >
              <div class="img">
                <img
                  v-if="it.kind === 'image'"
                  :src="thumbUrl(root, it.rel, 256)"
                  draggable="false"
                  alt=""
                />
                <!-- video poster = first frame via the #t fragment; no server-side thumbnailing needed -->
                <video
                  v-else-if="it.kind === 'video'"
                  :src="viewUrl(it, root) + '#t=0.1'"
                  muted
                  preload="metadata"
                  playsinline
                ></video>
                <i v-else-if="it.kind === 'audio'" class="mdi mdi-music-note vid"></i>
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
          @update:model-value="(v) => (cardW = v)"
        />
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
} from '@nynxz/zenkit-ui'
import { setImageDragData, openViewer, type ViewerItem } from '@nynxz/zenkit-client'
import { app } from '@comfy/app'
import {
  listAssets,
  listRoots,
  thumbUrl,
  viewUrl,
  type AssetItem,
  type AssetRoot,
  type RootInfo,
} from '../lib/api'
import { watchJobs } from '../lib/jobs'
import { watchOutputs, type LiveOutput } from '../lib/liveAssets'

// Drag a tile onto the ComfyUI graph. Everything we list already lives in ComfyUI's
// output/input/temp, so we pass `type`/`subfolder` — dropping on a loader node then points
// its widget at the existing file rather than re-uploading a duplicate into input/.
function onDragStart(e: DragEvent, it: AssetItem) {
  if (!DRAGGABLE.has(it.kind)) return
  const img = (e.currentTarget as HTMLElement | null)?.querySelector(
    'img',
  ) as HTMLImageElement | null
  setImageDragData(
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
const sortTg = SORTS.map((s) => ({ value: s.key, label: s.label }))
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
const OVERSCAN = 3
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

// Live scan progress for the current root (driven by zenkit.job events). The
// background reconcile after a generation runs the same scan, so gate the bar on
// `silentScan` — otherwise it would flash on every single generation.
const { progress: scanRaw, stop: stopJobs } = watchJobs(
  (id) => id === `zensuite:scan:${root.value}`,
)
const silentScan = ref(false)
const scan = computed(() => (silentScan.value ? null : scanRaw.value))
const scanPct = computed(() => {
  const s = scan.value
  return s && s.total ? Math.min(100, Math.round((s.current / s.total) * 100)) : 0
})
onBeforeUnmount(() => {
  stopJobs()
  stopOutputs?.()
  if (reconcileTimer) clearTimeout(reconcileTimer)
  ro?.disconnect()
})

const filtered = computed(() => {
  const f = filter.value.trim().toLowerCase()
  const list = f ? items.value.filter((i) => i.rel.toLowerCase().includes(f)) : items.value.slice()
  const dir = asc.value ? 1 : -1
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
const startRow = computed(() => Math.max(0, Math.floor(scrollTop.value / rowH.value) - OVERSCAN))
const endRow = computed(() =>
  Math.min(totalRows.value, Math.ceil((scrollTop.value + viewportH.value) / rowH.value) + OVERSCAN),
)
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
const lbItems = computed<ViewerItem[]>(() =>
  filtered.value.map((it) => ({
    src: viewUrl(it, root.value),
    kind: it.kind === 'video' ? 'video' : it.kind === 'audio' ? 'audio' : 'image',
    label: it.name,
    meta: it.subfolder || '',
    onWorkflow: canLoadWorkflow(it) ? () => loadWorkflow(it) : undefined,
  })),
)

watch([filter, sortKey, asc], () => {
  if (scrollEl.value) scrollEl.value.scrollTop = 0
  scrollTop.value = 0
})

function pickSort(k: SortKey) {
  sortKey.value = k
}

// View menu — controlled ZenPopover anchored to the ⚙ button (its own element from the click).
const viewOpen = ref(false)
const viewAnchor = ref<HTMLElement | null>(null)
function openView(e: MouseEvent) {
  viewAnchor.value = e.currentTarget as HTMLElement
  viewOpen.value = !viewOpen.value
}
function setRoot(r: AssetRoot) {
  if (root.value === r) return
  root.value = r
  if (scrollEl.value) scrollEl.value.scrollTop = 0
  scrollTop.value = 0
  selected.value = null
  load()
}
function openAt(i: number) {
  if (i >= 0) openViewer(lbItems.value, { index: i }) // shared host viewer (same as everywhere)
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
// Show the asset in the ZenSuite Media Viewer: publish it to a channel (the viewer's
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
    console.warn('[ZenSuite] load workflow failed', err)
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
  const row = Math.floor(el.scrollTop / rowH.value)
  const anchorRel = filtered.value[row * cols.value]?.rel
  const withinRow = el.scrollTop - row * rowH.value
  mutate()
  if (!anchorRel) return
  nextTick(() => {
    const i = filtered.value.findIndex((f) => f.rel === anchorRel)
    if (i < 0 || !scrollEl.value) return
    const top = Math.floor(i / cols.value) * rowH.value + withinRow
    scrollEl.value.scrollTop = top
    scrollTop.value = top
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
  stopOutputs = watchOutputs(onLiveOutputs)
  if (typeof ResizeObserver !== 'undefined' && scrollEl.value) {
    ro = new ResizeObserver(() => measure())
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
  color: #f87171;
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
.ob-scroll {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 8px;
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
.img video {
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
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 240px;
  color: var(--zen-muted, #9aa0aa);
}
.empty .mdi {
  font-size: 30px;
  opacity: 0.5;
}
.empty p {
  margin: 0;
  font-size: 12px;
}
</style>
