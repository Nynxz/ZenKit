<!-- The searchable, bookmarkable LoRA combo — one row's worth of picker, shared by every widget
     that has to choose a LoRA. Bookmarked names are pinned to the top by ZenCombo; the footer
     hands off to the full-library browser, which the host owns because it is a modal and belongs
     to the widget, not to one row of it. -->
<template>
  <ZenCombo
    :model-value="modelValue"
    :items="items"
    :pinned="lib.favorites.value"
    :menu-width="menuWidth"
    :item-height="54"
    :placeholder="placeholder"
    empty-text="No LoRAs found"
    @update:model-value="emit('update:modelValue', String($event))"
    @open="lib.ensure()"
  >
    <template #selected>
      <span class="lp-sel" :class="{ missing: lib.isMissing(modelValue) }">
        <LoraThumb :name="modelValue" sm check-missing />
        <span class="lp-sel-name">{{ modelValue ? lib.short(modelValue) : placeholder }}</span>
      </span>
    </template>

    <template #option="{ item }">
      <LoraThumb :name="String(item.value)" strict />
      <span class="lp-opt">
        <span class="lp-opt-name">{{ lib.short(item.value) }}</span>
        <span v-if="lib.folder(item.value)" class="lp-opt-dir">{{ lib.folder(item.value) }}</span>
      </span>
      <button
        class="lp-star"
        :class="{ on: lib.isFav(item.value) }"
        :title="lib.isFav(item.value) ? 'Remove bookmark' : 'Bookmark'"
        @click.stop="lib.toggleFav(item.value)"
      >
        <i class="mdi" :class="lib.isFav(item.value) ? 'mdi-star' : 'mdi-star-outline'" />
      </button>
    </template>

    <template #footer="{ close }">
      <ZenButton
        variant="ghost"
        sm
        block
        icon="mdi mdi-view-grid-outline"
        @click="browseAll(close)"
      >
        Browse all ({{ lib.loras.value.length }})
      </ZenButton>
    </template>
  </ZenCombo>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import ZenButton from '../../primitives/ZenButton.vue'
import ZenCombo from '../../inputs/ZenCombo.vue'
import type { ComboItem } from '../../types'

import LoraThumb from './LoraThumb.vue'
import * as lib from './loraLibrary'

withDefaults(defineProps<{ modelValue: string; placeholder?: string; menuWidth?: number }>(), {
  placeholder: 'Select a LoRA…',
  menuWidth: 400,
})
const emit = defineEmits<{ 'update:modelValue': [string]; browse: [] }>()

// Named rather than inlined in the template: Prettier's `semi: false` strips the separator
// from a multi-statement inline handler, and Vue cannot parse newline-separated statements.
function browseAll(close: () => void) {
  close()
  emit('browse')
}

const items = computed<ComboItem[]>(() =>
  lib.loras.value.map((l) => ({ value: l.name, label: lib.short(l.name), keywords: l.name })),
)
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
  color: var(--zen-danger, #f5665f);
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
  color: #f5b301;
}
</style>
