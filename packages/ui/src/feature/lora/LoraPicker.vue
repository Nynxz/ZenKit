<!-- The searchable, bookmarkable LoRA combo — one row's worth of picker, shared by every widget
     that has to choose a LoRA. With `folderNav` on it browses folder by folder (bookmarks at the
     top level); typing searches every folder. The browse button in the search row hands off to
     the full-library browser, which the host owns because it is a modal. -->
<template>
  <ZenCombo
    :model-value="modelValue"
    :items="items"
    :pinned="lib.favorites.value"
    :sorted="!browsing"
    :pick-guard="enterFolder"
    :menu-width="menuWidth"
    :item-height="54"
    :placeholder="placeholder"
    empty-text="No LoRAs found"
    @update:model-value="emit('update:modelValue', String($event))"
    @open="onOpen"
    @query="query = $event"
    @key="onKey"
  >
    <template #selected>
      <span class="lp-sel" :class="{ missing: lib.isMissing(modelValue) }">
        <LoraThumb :name="modelValue" sm check-missing />
        <span class="lp-sel-name">{{ modelValue ? lib.short(modelValue) : placeholder }}</span>
      </span>
    </template>

    <template #search="{ close }">
      <button
        type="button"
        class="lp-browse"
        :title="`Browse all (${lib.loras.value.length})`"
        @click="browseAll(close)"
      >
        <i class="mdi mdi-view-grid-outline" />
      </button>
    </template>

    <template v-if="browsing" #header>
      <div class="lp-crumbs">
        <button type="button" class="lp-up" :disabled="!here" title="Up (Backspace)" @click="up">
          <i class="mdi mdi-arrow-up" />
        </button>
        <button type="button" class="lp-crumb" :class="{ on: !here }" @click="path = ''">
          All
        </button>
        <template v-for="(seg, i) in crumbs" :key="i">
          <i class="mdi mdi-chevron-right" />
          <button
            type="button"
            class="lp-crumb"
            :class="{ on: i === crumbs.length - 1 }"
            @click="path = crumbs.slice(0, i + 1).join('/')"
          >
            {{ seg }}
          </button>
        </template>
      </div>
    </template>

    <template #option="{ item }">
      <template v-if="item.folder">
        <i class="mdi mdi-folder lp-folder" />
        <span class="lp-opt">
          <span class="lp-opt-name">{{ item.label }}</span>
          <span class="lp-opt-dir">{{ item.count }} LoRA{{ item.count === 1 ? '' : 's' }}</span>
        </span>
        <i class="mdi mdi-chevron-right lp-chev" />
      </template>
      <template v-else>
        <LoraThumb :name="String(item.value)" strict />
        <span class="lp-opt">
          <span class="lp-opt-name">{{ lib.short(item.value) }}</span>
          <span v-if="showFolder(item.value)" class="lp-opt-dir">
            {{ lib.folder(item.value) }}
          </span>
        </span>
        <button
          type="button"
          class="lp-star"
          :class="{ on: lib.isFav(item.value) }"
          :title="lib.isFav(item.value) ? 'Remove bookmark' : 'Bookmark'"
          @click.stop="lib.toggleFav(item.value)"
        >
          <i class="mdi" :class="lib.isFav(item.value) ? 'mdi-star' : 'mdi-star-outline'" />
        </button>
      </template>
    </template>
  </ZenCombo>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import ZenCombo from '../../inputs/ZenCombo.vue'
import type { ComboItem } from '../../types'

import LoraThumb from './LoraThumb.vue'
import * as lib from './loraLibrary'

const props = withDefaults(
  defineProps<{ modelValue: string; placeholder?: string; menuWidth?: number }>(),
  { placeholder: 'Select a LoRA…', menuWidth: 400 },
)
const emit = defineEmits<{ 'update:modelValue': [string]; browse: [] }>()

// Folder rows share the combo with LoRA rows; this prefix can't start a file path.
const DIR = '\u0000dir:'

const path = ref('')
const query = ref('')

/** `path` if it still exists in the listing, else the root. */
const here = computed(() => (lib.folderIndex.value.has(path.value) ? path.value : ''))
const crumbs = computed(() => (here.value ? here.value.split('/') : []))
const browsing = computed(
  () =>
    lib.folderNav.value &&
    !query.value.trim() &&
    (lib.folderIndex.value.get('')?.folders.length ?? 0) > 0,
)

function row(name: string): ComboItem {
  return { value: name, label: lib.short(name), keywords: name }
}

const items = computed<ComboItem[]>(() => {
  if (!browsing.value) return lib.loras.value.map((l) => row(l.name))
  const node = lib.folderIndex.value.get(here.value)
  if (!node) return []
  const folders = node.folders.map((f) => {
    const full = here.value ? `${here.value}/${f}` : f
    return {
      value: DIR + full,
      label: f,
      folder: true,
      count: lib.folderIndex.value.get(full)?.total,
    }
  })
  const favs = lib.favorites.value.filter((n) => !lib.isMissing(n))
  if (!here.value) {
    const rest = node.files.filter((n) => !lib.isFav(n))
    return [...favs.map(row), ...folders, ...rest.map(row)]
  }
  const pinned = node.files.filter((n) => lib.isFav(n))
  const rest = node.files.filter((n) => !lib.isFav(n))
  return [...folders, ...pinned.map(row), ...rest.map(row)]
})

/** A LoRA's folder is noise when the list is already showing that folder. */
function showFolder(name: unknown): boolean {
  const dir = lib.folder(name)
  return !!dir && (!browsing.value || dir !== here.value)
}

function onOpen() {
  void lib.ensure()
  query.value = ''
  path.value = lib.folder(props.modelValue)
}

function enterFolder(value: string | number): boolean {
  const v = String(value)
  if (!v.startsWith(DIR)) return false
  path.value = v.slice(DIR.length)
  return true
}

function up() {
  path.value = here.value.split('/').slice(0, -1).join('/')
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Backspace' && browsing.value && here.value) {
    e.preventDefault()
    up()
  }
}

// Named rather than inlined in the template: Prettier's `semi: false` strips the separator
// from a multi-statement inline handler, and Vue cannot parse newline-separated statements.
function browseAll(close: () => void) {
  close()
  emit('browse')
}
</script>

<style scoped>
.lp-sel {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}
.lp-sel-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* a chosen LoRA that no longer exists on disk */
.lp-sel.missing .lp-sel-name {
  color: var(--zen-danger, #dc2626);
}
.lp-opt {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
  line-height: 1.25;
}
.lp-opt-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
}
.lp-opt-dir {
  font-size: 10px;
  color: var(--zen-muted, #9aa0aa);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lp-star {
  flex: none;
  border: none;
  background: none;
  cursor: pointer;
  color: var(--zen-muted, #9aa0aa);
  font-size: 15px;
  padding: 2px;
  display: inline-flex;
}
.lp-star.on,
.lp-star:hover {
  color: var(--zen-star, #f5b301);
}
.lp-browse {
  border: none;
  background: none;
  cursor: pointer;
  color: var(--zen-muted, #9aa0aa);
  font-size: 16px;
  padding: 0 2px;
  display: inline-flex;
}
.lp-browse:hover {
  color: var(--zen-text, #e5e5ea);
}
.lp-crumbs {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  padding: 4px 8px;
  overflow: hidden;
  white-space: nowrap;
}
.lp-crumbs > .mdi {
  flex: none;
  font-size: 13px;
  color: var(--zen-muted, #9aa0aa);
}
.lp-up,
.lp-crumb {
  flex: none;
  border: none;
  background: none;
  cursor: pointer;
  font: inherit;
  font-size: 11.5px;
  padding: 2px 5px;
  border-radius: var(--zen-radius, 7px);
  color: var(--zen-muted, #9aa0aa);
}
.lp-crumb.on {
  color: var(--zen-text, #e5e5ea);
  font-weight: 600;
}
.lp-up:hover:not(:disabled),
.lp-crumb:hover {
  color: var(--zen-text, #e5e5ea);
  background: color-mix(in srgb, var(--zen-text, #e5e5ea) 6%, transparent);
}
.lp-up:disabled {
  opacity: 0.35;
  cursor: default;
}
.lp-folder {
  flex: none;
  box-sizing: border-box;
  width: 40px;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  color: var(--zen-accent, #6366f1);
  border-radius: var(--zen-radius, 7px);
  background: color-mix(in srgb, var(--zen-accent, #6366f1) 10%, var(--zen-input, #1b1b20));
  border: 1px solid var(--zen-border, #34343c);
}
.lp-chev {
  flex: none;
  color: var(--zen-muted, #9aa0aa);
  font-size: 16px;
}
</style>
