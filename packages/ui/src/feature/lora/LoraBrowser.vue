<!-- The full-library modal: a card grid with search, a bookmarked filter, and a folder view for
     a LoRA directory deep enough that a flat list stops being navigable. Emits the name picked;
     what to DO with it belongs to the widget that opened it. Shift+click or the info badge opens
     a details pane beside the grid. -->
<template>
  <ZenModal
    :open="open"
    title="LoRA browser"
    :width="detail ? '1240px' : '880px'"
    height="78vh"
    @update:open="setOpen"
  >
    <template #header>
      <span class="lb-search"><ZenInput v-model="query" placeholder="Search LoRAs…" sm /></span>
      <ZenToggleGroup v-model="mode" :options="MODES" />
      <ZenToggleGroup v-model="filter" :options="FILTERS" />
    </template>

    <!-- breadcrumb (folder mode, not searching) -->
    <div v-if="folderActive" class="lb-crumbs">
      <button class="lb-crumb" :class="{ on: !path }" @click="path = ''">all</button>
      <template v-for="(seg, i) in crumbs" :key="i">
        <i class="mdi mdi-chevron-right" />
        <button
          class="lb-crumb"
          :class="{ on: i === crumbs.length - 1 }"
          @click="path = crumbs.slice(0, i + 1).join('/')"
        >
          {{ seg }}
        </button>
      </template>
    </div>

    <div class="lb-layout">
      <div class="lb-grid">
        <button v-for="f in gridFolders" :key="'d:' + f" class="lb-card folder" @click="enter(f)">
          <div class="lb-img"><i class="mdi mdi-folder" /></div>
          <div class="lb-meta">
            <span class="lb-name" :title="f">{{ f }}</span>
            <span class="lb-dir">folder</span>
          </div>
        </button>

        <button
          v-for="it in gridFiles"
          :key="it.name"
          class="lb-card"
          :class="{ sel: selected === it.name, info: detail === it.name }"
          @click="onCard($event, it.name)"
        >
          <div
            class="lb-img"
            @mouseenter="hoverStart(it.name, $event.currentTarget as HTMLElement, $event.shiftKey)"
            @mouseleave="hoverEnd($event.currentTarget as HTMLElement)"
          >
            <img
              v-if="lib.hasPreview(it.name)"
              :src="lib.preview(it.name)"
              loading="lazy"
              @error="lib.onImageError"
            />
            <i v-else class="mdi mdi-cube-outline" />
            <i v-if="lib.previewKind(it.name) === 'video'" class="mdi mdi-play-circle lb-video" />
            <span class="lb-info" title="Details" @click.stop="detail = it.name">
              <i class="mdi mdi-information-outline" />
            </span>
            <span
              class="lb-star"
              :class="{ on: lib.isFav(it.name) }"
              @click.stop="lib.toggleFav(it.name)"
            >
              <i class="mdi" :class="lib.isFav(it.name) ? 'mdi-star' : 'mdi-star-outline'" />
            </span>
          </div>
          <div class="lb-meta">
            <span class="lb-name" :title="it.name">{{ lib.short(it.name) }}</span>
            <span class="lb-dir">{{ folderActive ? '—' : lib.folder(it.name) || '—' }}</span>
          </div>
        </button>

        <p v-if="!gridFolders.length && !gridFiles.length" class="lb-empty">
          {{ folderActive ? 'Empty folder.' : 'No matches.' }}
        </p>
      </div>

      <aside v-if="detail" class="lb-detail">
        <button class="lb-detail-x" title="Close details" @click="detail = ''">
          <i class="mdi mdi-close" />
        </button>
        <LoraDetail :name="detail" pickable @pick="emit('pick', $event)" />
      </aside>
    </div>
  </ZenModal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ZenInput from '../../inputs/ZenInput.vue'
import ZenModal from '../../overlays/ZenModal.vue'
import ZenToggleGroup from '../../inputs/ZenToggleGroup.vue'

import LoraDetail from './LoraDetail.vue'
import * as lib from './loraLibrary'
import { hoverEnd, hoverStart } from './loraOverlays'
import type { LoraItem } from './types'

const props = defineProps<{ open: boolean; selected?: string }>()
const emit = defineEmits<{ 'update:open': [boolean]; pick: [string] }>()

const query = ref('')
const filter = ref<'all' | 'fav'>('all')
const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'fav', label: 'Bookmarked', icon: 'mdi mdi-star' },
]
const mode = ref<'flat' | 'folder'>('flat')
const MODES = [
  { value: 'flat', label: 'Flat' },
  { value: 'folder', label: 'Folders' },
]
const path = ref('')
const detail = ref('')

// Opening always lands at the library root: a path left over from a previous open would show a
// subfolder with no visible reason for it.
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      path.value = ''
      detail.value = ''
      void lib.ensure()
    }
  },
)

function setOpen(v: boolean) {
  emit('update:open', v)
}

const matches = computed(() => {
  const q = query.value.trim().toLowerCase()
  return lib.loras.value.filter((l) => {
    if (filter.value === 'fav' && !lib.isFav(l.name)) return false
    return !q || l.name.toLowerCase().includes(q)
  })
})

// Folder navigation is active only in folder mode with no search — a search flattens across all
// folders, which is the point of typing one.
const folderActive = computed(() => mode.value === 'folder' && !query.value.trim())
const crumbs = computed(() => (path.value ? path.value.split('/') : []))
const folderView = computed(() => {
  const prefix = path.value ? path.value + '/' : ''
  const folders = new Set<string>()
  const files: LoraItem[] = []
  for (const l of matches.value) {
    if (prefix && !l.name.startsWith(prefix)) continue
    const rest = l.name.slice(prefix.length)
    const slash = rest.indexOf('/')
    if (slash === -1)
      files.push(l) // a LoRA directly in this folder
    else folders.add(rest.slice(0, slash)) // an immediate subfolder
  }
  return { folders: [...folders].sort(), files }
})
const gridFolders = computed(() => (folderActive.value ? folderView.value.folders : []))
const gridFiles = computed(() => (folderActive.value ? folderView.value.files : matches.value))

function onCard(e: MouseEvent, name: string) {
  if (e.shiftKey) detail.value = name
  else emit('pick', name)
}

function enter(name: string) {
  path.value = path.value ? path.value + '/' + name : name
}
</script>

<style scoped>
.lb-search {
  flex: 1;
  min-width: 0;
  max-width: 320px;
  display: flex;
}
.lb-crumbs {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px;
  padding-bottom: 10px;
}
.lb-crumb {
  background: none;
  border: none;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  padding: 2px 6px;
  border-radius: var(--zen-radius, 5px);
  color: var(--zen-muted, #9aa0aa);
}
.lb-crumb:hover {
  color: var(--zen-text, #e5e5ea);
  background: color-mix(in srgb, var(--zen-text, #fff) 6%, transparent);
}
.lb-crumb.on {
  color: var(--zen-text, #e5e5ea);
  font-weight: 600;
}
.lb-crumbs .mdi {
  color: var(--zen-muted, #9aa0aa);
  font-size: 14px;
}

.lb-layout {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}
.lb-grid {
  flex: 1;
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 12px;
  align-items: start;
}
/* every card is a fixed size: fixed-height image + fixed-height meta, so neither the image
   dimensions nor the text length can change a card's footprint. */
.lb-card {
  display: flex;
  flex-direction: column;
  height: 170px;
  padding: 0;
  border: 1px solid var(--zen-border, #34343c);
  border-radius: var(--zen-radius, 9px);
  background: var(--zen-input, #1b1b20);
  cursor: pointer;
  overflow: hidden;
  text-align: left;
  color: inherit;
  font: inherit;
}
.lb-card:hover {
  border-color: var(--zen-accent, #6366f1);
}
.lb-card.sel {
  border-color: var(--zen-accent, #6366f1);
  box-shadow: 0 0 0 1px var(--zen-accent, #6366f1) inset;
}
.lb-img {
  position: relative;
  flex: 1 1 0;
  min-height: 0;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--zen-surface, #202026);
  overflow: hidden;
}
.lb-img img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
.lb-img > .mdi {
  font-size: 32px;
  color: var(--zen-muted, #9aa0aa);
}
.lb-card.folder .lb-img {
  background: color-mix(in srgb, var(--zen-accent, #6366f1) 8%, var(--zen-surface, #202026));
}
.lb-card.folder .lb-img > .mdi {
  font-size: 40px;
  color: var(--zen-accent, #6366f1);
}
.lb-star {
  position: absolute;
  top: 5px;
  right: 5px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: rgb(0 0 0 / 50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 14px;
}
.lb-star.on {
  color: #f5b301;
}
.lb-info {
  position: absolute;
  top: 5px;
  left: 5px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: rgb(0 0 0 / 50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 14px;
  opacity: 0;
  transition: opacity 0.12s;
}
.lb-card:hover .lb-info,
.lb-card.info .lb-info {
  opacity: 1;
}
.lb-card.info {
  border-color: var(--zen-accent, #6366f1);
}
.lb-video {
  position: absolute;
  right: 6px;
  bottom: 6px;
  font-size: 18px;
  color: #fff;
  text-shadow: 0 1px 3px rgb(0 0 0 / 70%);
}
.lb-detail {
  position: sticky;
  top: 0;
  flex: none;
  width: 400px;
  height: calc(78vh - 90px);
  border: 1px solid var(--zen-border, #34343c);
  border-radius: var(--zen-radius, 9px);
  background: var(--zen-surface, #202026);
  overflow: hidden;
}
.lb-detail-x {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 1;
  border: none;
  background: none;
  cursor: pointer;
  color: var(--zen-muted, #9aa0aa);
  font-size: 16px;
  padding: 2px;
}
.lb-detail-x:hover {
  color: var(--zen-text, #e5e5ea);
}
/* fixed-height meta so every card is identical regardless of folder/name length */
.lb-meta {
  flex: none;
  height: 38px;
  box-sizing: border-box;
  padding: 5px 8px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 1px;
  border-top: 1px solid var(--zen-border, #34343c);
}
.lb-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
.lb-dir {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  color: var(--zen-muted, #9aa0aa);
}
.lb-empty {
  grid-column: 1 / -1;
  text-align: center;
  color: var(--zen-muted, #9aa0aa);
  padding: 30px;
}
</style>
