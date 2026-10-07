<!-- The full-library LoRA browser, laid out like ZenMediaPicker: folders down the left, a grid of
     previews in the middle, the selected LoRA's details on the right. Click a card to see it,
     double-click (or Enter, or Use) to pick it. Emits the name picked; what to DO with it belongs
     to the widget that opened it. -->
<template>
  <ZenModal :open="open" title="LoRA browser" width="1240px" height="82vh" @update:open="setOpen">
    <template #header>
      <span class="lb-search">
        <ZenInput v-model="query" sm :placeholder="`Search ${scopeLabel}…`" />
      </span>
      <ZenIconButton
        icon="mdi mdi-refresh"
        title="Rescan the LoRA folders"
        @click="lib.ensure(true)"
      />
    </template>

    <div class="lb" @keydown="onKey">
      <!-- folders -->
      <nav class="lb-folders zen-scroll">
        <button
          type="button"
          class="lb-folder"
          :class="{ on: scope === ALL }"
          @click="setScope(ALL)"
        >
          <i class="mdi mdi-folder-multiple-outline" />
          <span class="lb-fname">All LoRAs</span>
          <span class="lb-count">{{ lib.loras.value.length }}</span>
        </button>
        <button
          type="button"
          class="lb-folder"
          :class="{ on: scope === FAV }"
          @click="setScope(FAV)"
        >
          <i class="mdi mdi-star" />
          <span class="lb-fname">Bookmarked</span>
          <span class="lb-count">{{ favCount }}</span>
        </button>
        <div v-if="tree.length" class="lb-sep" />
        <ZenFolderTree
          :folders="tree"
          :model-value="scope === ALL || scope === FAV ? null : scope"
          storage-key="zenkit.loraBrowser.open"
          @update:model-value="(p) => p && setScope(p)"
        />
      </nav>

      <!-- grid -->
      <section class="lb-main">
        <div class="lb-filters">
          <span class="lb-scope">
            <i class="mdi" :class="scope === FAV ? 'mdi-star' : 'mdi-folder-outline'" />
            {{ scopeLabel }}
            <span class="lb-soft">· {{ visible.length }}</span>
          </span>
          <span class="lb-grow" />
          <ZenToggleGroup v-model="sort" :options="SORTS" />
          <ZenToggleGroup v-if="view === 'grid'" v-model="size" :options="SIZES" />
          <ZenToggleGroup v-model="view" :options="VIEWS" />
        </div>

        <!-- list: one line per LoRA, quick to scan and to scroll -->
        <div v-if="view === 'list'" class="lb-list">
          <div class="lb-lhead">
            <span />
            <span>Name</span>
            <span>Folder</span>
            <span class="num">Size</span>
            <span class="num">Modified</span>
            <span />
          </div>
          <div
            ref="listEl"
            class="lb-lrows zen-scroll"
            tabindex="0"
            :style="rowsGrid.containerStyle.value"
          >
            <div :style="rowsGrid.padTop.value" />
            <div
              v-for="it in shownRows"
              :key="it.name"
              class="lb-row"
              :class="{ focus: focused === it.name, current: selected === it.name }"
              :data-name="it.name"
              :title="it.name"
              @click="focused = it.name"
              @dblclick="emit('pick', it.name)"
            >
              <span
                class="lb-rthumb"
                @mouseenter="hoverStart(it.name, $event.currentTarget as HTMLElement)"
                @mouseleave="hoverEnd($event.currentTarget as HTMLElement)"
              >
                <img
                  v-if="lib.hasPreview(it.name)"
                  :src="lib.preview(it.name)"
                  loading="lazy"
                  decoding="async"
                  alt=""
                  @error="lib.onImageError"
                />
                <i v-else class="mdi mdi-cube-outline" />
              </span>
              <span class="lb-rname">
                {{ lib.short(it.name) }}
                <i
                  v-if="lib.previewKind(it.name) === 'video'"
                  class="mdi mdi-play-circle-outline"
                />
                <i
                  v-if="selected === it.name"
                  class="mdi mdi-check lb-rcur"
                  title="Already chosen here"
                />
              </span>
              <span class="lb-rdir">{{ lib.folder(it.name) || '—' }}</span>
              <span class="num">{{ bytes(it.size) }}</span>
              <span class="num">{{ when(it.mtime) }}</span>
              <span
                class="lb-rstar"
                :class="{ on: lib.isFav(it.name) }"
                :title="lib.isFav(it.name) ? 'Remove bookmark' : 'Bookmark'"
                @click.stop="lib.toggleFav(it.name)"
                @dblclick.stop
              >
                <i class="mdi" :class="lib.isFav(it.name) ? 'mdi-star' : 'mdi-star-outline'" />
              </span>
            </div>
            <div :style="rowsGrid.padBottom.value" />
          </div>
        </div>

        <div
          v-else
          ref="gridEl"
          class="lb-grid zen-scroll"
          tabindex="0"
          :style="grid.containerStyle.value"
        >
          <div :style="grid.padTop.value" />
          <button
            v-for="it in shownCards"
            :key="it.name"
            type="button"
            class="lb-card"
            :class="{ focus: focused === it.name, current: selected === it.name }"
            :data-name="it.name"
            :title="it.name"
            @click="focused = it.name"
            @dblclick="emit('pick', it.name)"
            @mouseenter="hover = it.name"
            @mouseleave="hover = ''"
          >
            <span class="lb-img">
              <video
                v-if="lib.previewKind(it.name) === 'video' && hover === it.name"
                :src="lib.media(it.name)"
                muted
                autoplay
                loop
                playsinline
              />
              <img
                v-else-if="lib.hasPreview(it.name)"
                :src="lib.preview(it.name)"
                loading="lazy"
                decoding="async"
                alt=""
                @error="lib.onImageError"
              />
              <i v-else class="mdi mdi-cube-outline lb-noimg" />
              <span v-if="lib.previewKind(it.name) === 'video'" class="lb-badge">
                <i class="mdi mdi-play" />
              </span>
              <span
                class="lb-star"
                :class="{ on: lib.isFav(it.name) }"
                :title="lib.isFav(it.name) ? 'Remove bookmark' : 'Bookmark'"
                @click.stop="lib.toggleFav(it.name)"
                @dblclick.stop
              >
                <i class="mdi" :class="lib.isFav(it.name) ? 'mdi-star' : 'mdi-star-outline'" />
              </span>
              <span v-if="selected === it.name" class="lb-inuse" title="Already chosen here">
                <i class="mdi mdi-check" />
              </span>
            </span>
            <span class="lb-name">{{ lib.short(it.name) }}</span>
            <span v-if="showFolder(it.name)" class="lb-dir">{{ lib.folder(it.name) }}</span>
          </button>

          <div :style="grid.padBottom.value" />

          <div v-if="!lib.listLoaded.value" class="lb-empty">
            <i class="mdi mdi-loading mdi-spin" />
            Loading LoRAs…
          </div>
          <div v-else-if="!visible.length" class="lb-empty">
            <i class="mdi" :class="scope === FAV ? 'mdi-star-outline' : 'mdi-magnify-close'" />
            {{
              query.trim()
                ? `Nothing matches “${query.trim()}” in ${scopeLabel}.`
                : scope === FAV
                  ? 'No bookmarks yet — star a LoRA to keep it here.'
                  : 'No LoRAs in this folder.'
            }}
          </div>
        </div>
      </section>

      <!-- details -->
      <aside class="lb-detail zen-scroll">
        <LoraDetail
          v-if="focused"
          :key="focused"
          :name="focused"
          pickable
          @pick="emit('pick', $event)"
        />
        <div v-else class="lb-hint">
          <i class="mdi mdi-gesture-tap" />
          Click a LoRA to see its details — trigger words, examples, base model. Double-click (or
          Enter) to use it.
        </div>
      </aside>
    </div>

    <template #footer>
      <div class="lb-foot">
        <span class="lb-soft lb-foot-name">
          <template v-if="focused">{{ focused }}</template>
          <template v-else>{{ lib.loras.value.length }} LoRAs</template>
        </span>
        <span class="lb-grow" />
        <ZenButton variant="ghost" sm @click="setOpen(false)">Cancel</ZenButton>
        <ZenButton
          variant="primary"
          sm
          :disabled="!focused"
          @click="focused && emit('pick', focused)"
        >
          Use
        </ZenButton>
      </div>
    </template>
  </ZenModal>
</template>

<script setup lang="ts">
import '../../lib/motion.css'
import { computed, nextTick, ref, watch } from 'vue'
import ZenFolderTree from '../../data/ZenFolderTree.vue'
import ZenInput from '../../inputs/ZenInput.vue'
import ZenToggleGroup from '../../inputs/ZenToggleGroup.vue'
import ZenModal from '../../overlays/ZenModal.vue'
import ZenButton from '../../primitives/ZenButton.vue'
import ZenIconButton from '../../primitives/ZenIconButton.vue'

import LoraDetail from './LoraDetail.vue'
import * as lib from './loraLibrary'
import type { LoraItem } from './types'
import { useVirtualGrid } from '../../lib/useVirtualGrid'
import { hoverEnd, hoverStart } from './loraOverlays'

const props = defineProps<{ open: boolean; selected?: string }>()
const emit = defineEmits<{ 'update:open': [boolean]; pick: [string] }>()

/** Scopes besides a folder path. They can't collide with one: a path never starts with NUL. */
const ALL = '\u0000all'
const FAV = '\u0000fav'
const SORTS = [
  { value: 'name', icon: 'mdi mdi-sort-alphabetical-ascending', title: 'By name' },
  { value: 'folder', icon: 'mdi mdi-file-tree-outline', title: 'By folder, then name' },
  { value: 'new', icon: 'mdi mdi-clock-outline', title: 'Newest first' },
  { value: 'big', icon: 'mdi mdi-sort-numeric-descending', title: 'Largest first' },
]
const VIEWS = [
  { value: 'grid', icon: 'mdi mdi-view-grid-outline', title: 'Cards' },
  { value: 'list', icon: 'mdi mdi-view-list-outline', title: 'List' },
]
const SIZES = [
  { value: 's', icon: 'mdi mdi-view-grid-compact', title: 'Small' },
  { value: 'm', icon: 'mdi mdi-view-grid-outline', title: 'Medium' },
  { value: 'l', icon: 'mdi mdi-view-module-outline', title: 'Large' },
]
const CARD: Record<string, number> = { s: 104, m: 148, l: 210 }
const PREFS = 'zenkit.loraBrowser'

const scope = ref(ALL)
const query = ref('')
const sort = ref('name')
const view = ref<'grid' | 'list'>('grid')
const listEl = ref<HTMLElement | null>(null)
const size = ref('m')
const focused = ref('')
const hover = ref('')
const gridEl = ref<HTMLElement | null>(null)

try {
  const saved = JSON.parse(localStorage.getItem(PREFS) ?? '{}') as Record<string, string>
  if (saved.sort) sort.value = saved.sort
  if (saved.size) size.value = saved.size
  if (saved.view === 'list' || saved.view === 'grid') view.value = saved.view
} catch {
  // preferences are a convenience
}
watch([sort, size, view], () => {
  try {
    localStorage.setItem(
      PREFS,
      JSON.stringify({ sort: sort.value, size: size.value, view: view.value }),
    )
  } catch {
    // preferences are a convenience
  }
})

// Opening lands on the LoRA already chosen (its folder, and its details), or the whole library.
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    query.value = ''
    focused.value = props.selected ?? ''
    const dir = props.selected ? lib.folder(props.selected) : ''
    scope.value = dir && lib.folderIndex.value.has(dir) ? dir : ALL
    void lib.ensure().then(() => nextTick(scrollToFocus))
  },
  { immediate: true },
)

function setOpen(v: boolean) {
  emit('update:open', v)
}
function setScope(s: string) {
  scope.value = s
}

const favCount = computed(() => lib.favorites.value.filter((n) => !lib.isMissing(n)).length)
const scopeLabel = computed(() =>
  scope.value === ALL
    ? 'all LoRAs'
    : scope.value === FAV
      ? 'bookmarks'
      : (scope.value.split('/').pop() ?? scope.value),
)

/** Every folder path, with how many LoRAs it holds (subfolders included). */
const tree = computed(() =>
  [...lib.folderIndex.value.entries()]
    .filter(([path]) => path)
    .map(([path, node]) => ({ path, count: node.total })),
)

const visible = computed<LoraItem[]>(() => {
  const q = query.value.trim().toLowerCase()
  const inScope = (l: LoraItem) =>
    scope.value === ALL ||
    (scope.value === FAV ? lib.isFav(l.name) : l.name.startsWith(`${scope.value}/`))
  const list = lib.loras.value.filter((l) => inScope(l) && (!q || l.name.toLowerCase().includes(q)))
  const byName = (a: LoraItem, b: LoraItem) =>
    lib.short(a.name).localeCompare(lib.short(b.name), undefined, { numeric: true })
  if (sort.value === 'folder')
    return list.sort((a, b) => lib.folder(a.name).localeCompare(lib.folder(b.name)) || byName(a, b))
  if (sort.value === 'new')
    return list.sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0) || byName(a, b))
  if (sort.value === 'big')
    return list.sort((a, b) => (b.size ?? 0) - (a.size ?? 0) || byName(a, b))
  return list.sort(byName)
})

/** A LoRA's folder is noise when the grid is already showing exactly that folder. */
function showFolder(name: string): boolean {
  const dir = lib.folder(name)
  return !!dir && dir !== scope.value
}

// --- the grid only renders the rows on screen: a big library opens and scrolls as fast as a small one
const grid = useVirtualGrid(gridEl, () => visible.value.length, {
  minWidth: () => CARD[size.value]!,
  estimate: (w) => w * (4 / 3) + 44,
})
const shownCards = computed(() => visible.value.slice(grid.start.value, grid.end.value))
watch(shownCards, () => void nextTick(() => grid.measure('.lb-card')))
const rowsGrid = useVirtualGrid(listEl, () => visible.value.length, {
  minWidth: () => 100000,
  gap: 0,
  padding: 0,
  estimate: () => 34,
})
const shownRows = computed(() => visible.value.slice(rowsGrid.start.value, rowsGrid.end.value))
watch(shownRows, () => void nextTick(() => rowsGrid.measure('.lb-row')))
// A new scope or search starts at the top.
watch([scope, query, sort, view], () => {
  if (gridEl.value) gridEl.value.scrollTop = 0
  if (listEl.value) listEl.value.scrollTop = 0
})

function bytes(n?: number | null) {
  if (!n) return '—'
  return n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${(n / 1024 ** 2).toFixed(0)} MB`
}
function when(t?: number | null) {
  return t ? new Date(t * 1000).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—'
}

// --- keyboard: arrows move through the grid, Enter picks -----------------------------------------
function scrollToFocus() {
  const i = visible.value.findIndex((l) => l.name === focused.value)
  if (view.value === 'list') rowsGrid.reveal(i)
  else grid.reveal(i)
}
function onKey(e: KeyboardEvent) {
  const target = e.target as HTMLElement
  if (target.closest('input, textarea')) {
    if (e.key === 'Enter' && focused.value) emit('pick', focused.value)
    if (e.key !== 'ArrowDown') return
  }
  const names = visible.value.map((l) => l.name)
  if (!names.length) return
  const i = names.indexOf(focused.value)
  const step: Record<string, number> = {
    ArrowRight: 1,
    ArrowLeft: -1,
    ArrowDown: view.value === 'list' ? 1 : grid.columns.value,
    ArrowUp: view.value === 'list' ? -1 : -grid.columns.value,
  }
  if (e.key in step) {
    e.preventDefault()
    focused.value = names[Math.min(names.length - 1, Math.max(0, i < 0 ? 0 : i + step[e.key]!))]!
    void nextTick(scrollToFocus)
  } else if (e.key === 'Enter' && focused.value) {
    e.preventDefault()
    emit('pick', focused.value)
  }
}
</script>

<style scoped>
.lb {
  display: grid;
  grid-template-columns: 210px minmax(0, 1fr) 360px;
  height: calc(100% + 28px);
  margin: -14px;
  font-size: 12px;
}
.lb-search {
  display: flex;
  flex: 1;
  max-width: 340px;
}
.lb-grow {
  flex: 1;
}
.lb-soft {
  color: var(--zen-muted, #9aa0aa);
}

/* folders */
.lb-folders {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 8px;
  border-right: 1px solid var(--zen-border, #34343c);
}
.lb-folder {
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
.lb-folder:hover {
  background: color-mix(in srgb, var(--zen-text, #e5e5ea) 6%, transparent);
  color: var(--zen-text, #e5e5ea);
}
.lb-folder.on {
  background: color-mix(in srgb, var(--zen-accent, #6366f1) 20%, transparent);
  color: var(--zen-text, #e5e5ea);
}
.lb-folder .mdi {
  flex: none;
  font-size: 15px;
}
.lb-folder .mdi-star {
  color: var(--zen-star, #f5b301);
}
.lb-fname {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.lb-count {
  flex: none;
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
}
.lb-sep {
  margin: 6px 4px;
  border-top: 1px solid var(--zen-border, #34343c);
}

/* grid */
.lb-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.lb-filters {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--zen-border, #34343c);
}
.lb-scope {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-weight: 600;
}
.lb-grid {
  display: grid;
  flex: 1;
  align-content: start;
  gap: 10px;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
  outline: none;
}
.lb-card {
  display: flex;
  flex-direction: column;
  gap: 3px;
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
/* The accent outline on the selected card is the focus indicator; the browser's own ring would
   linger on the last card clicked while the arrow keys move the selection elsewhere. */
.lb-card:focus {
  outline: none;
}
.lb-card:hover {
  background: color-mix(in srgb, var(--zen-text, #e5e5ea) 5%, transparent);
}
.lb-card.focus .lb-img {
  outline: 2px solid var(--zen-accent, #6366f1);
  outline-offset: 1px;
}
.lb-img {
  position: relative;
  display: grid;
  place-items: center;
  aspect-ratio: 3 / 4;
  overflow: hidden;
  border-radius: var(--zen-radius, 7px);
  background: var(--zen-media-bg, #0b0b0e);
}
.lb-img img,
.lb-img video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.lb-noimg {
  color: var(--zen-muted, #9aa0aa);
  font-size: 30px;
  opacity: 0.5;
}
.lb-badge,
.lb-star,
.lb-inuse {
  position: absolute;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: rgb(0 0 0 / 60%);
  color: #fff;
  font-size: 13px;
}
.lb-badge {
  bottom: 5px;
  left: 5px;
}
.lb-star {
  top: 5px;
  right: 5px;
  opacity: 0;
  transition: opacity var(--zen-dur-fast, 0.12s);
}
.lb-card:hover .lb-star,
.lb-star.on {
  opacity: 1;
}
.lb-star.on {
  color: var(--zen-star, #f5b301);
}
.lb-inuse {
  top: 5px;
  left: 5px;
  background: var(--zen-accent, #6366f1);
  color: var(--zen-accent-text, #fff);
}
.lb-name,
.lb-dir {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.lb-name {
  font-size: 11.5px;
}
.lb-dir {
  margin-top: -2px;
  color: var(--zen-muted, #9aa0aa);
  font-size: 10.5px;
}
.lb-empty {
  display: flex;
  flex-direction: column;
  grid-column: 1 / -1;
  align-items: center;
  gap: 6px;
  padding: 48px 12px;
  color: var(--zen-muted, #9aa0aa);
  text-align: center;
}
.lb-empty .mdi {
  font-size: 28px;
}

/* list */
.lb-list {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
.lb-lhead,
.lb-row {
  display: grid;
  grid-template-columns: 34px minmax(0, 2.4fr) minmax(0, 1.2fr) 72px 104px 28px;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
}
.lb-lhead {
  flex: none;
  height: 28px;
  border-bottom: 1px solid var(--zen-border, #34343c);
  color: var(--zen-muted, #9aa0aa);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}
.lb-lrows {
  display: grid;
  flex: 1;
  align-content: start;
  min-height: 0;
  overflow-y: auto;
  outline: none;
}
.lb-row {
  height: 34px;
  border-bottom: 1px solid color-mix(in srgb, var(--zen-border, #34343c) 50%, transparent);
  cursor: pointer;
}
.lb-row:hover {
  background: color-mix(in srgb, var(--zen-text, #e5e5ea) 5%, transparent);
}
.lb-row.focus {
  background: color-mix(in srgb, var(--zen-accent, #6366f1) 18%, transparent);
}
.lb-rthumb {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  overflow: hidden;
  border-radius: 5px;
  background: var(--zen-media-bg, #0b0b0e);
  color: var(--zen-muted, #9aa0aa);
}
.lb-rthumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.lb-rname,
.lb-rdir {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.lb-rname .mdi {
  margin-left: 4px;
  color: var(--zen-muted, #9aa0aa);
}
.lb-rname .lb-rcur {
  color: var(--zen-accent, #6366f1);
}
.lb-rdir {
  color: var(--zen-muted, #9aa0aa);
}
.num {
  color: var(--zen-muted, #9aa0aa);
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.lb-rstar {
  display: grid;
  place-items: center;
  color: var(--zen-muted, #9aa0aa);
  opacity: 0;
}
.lb-row:hover .lb-rstar,
.lb-rstar.on {
  opacity: 1;
}
.lb-rstar.on {
  color: var(--zen-star, #f5b301);
}

/* details */
.lb-detail {
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
  border-left: 1px solid var(--zen-border, #34343c);
}
.lb-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin-top: 40%;
  color: var(--zen-muted, #9aa0aa);
  line-height: 1.5;
  text-align: center;
}
.lb-hint .mdi {
  font-size: 26px;
}

.lb-foot {
  display: flex;
  align-items: center;
  gap: 8px;
}
.lb-foot-name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
</style>
