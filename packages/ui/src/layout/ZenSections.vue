<script setup lang="ts">
// ZenSections — groups ZenSection children so open/closed is decided in one place.
//
//   <ZenSections v-model="openId" accordion>
//     <ZenSection value="transform" title="Transform">…</ZenSection>
//     <ZenSection value="crop" title="Cropping">…</ZenSection>
//   </ZenSections>
//
// `accordion`: one open at a time, v-model is the open value (or null). Otherwise each section
// toggles on its own and v-model is the array of open values. Unbound, the group seeds itself
// from the sections' own `open` props (in an accordion, the first open one wins).
import { onMounted, provide } from 'vue'
import { SECTIONS_KEY } from '../lib/sections'

const props = withDefaults(
  defineProps<{
    /** One section open at a time. */
    accordion?: boolean
    /** Gap between sections, in px. 0 suits `plain` (they draw their own dividers); ~6 suits `card`. */
    gap?: number
  }>(),
  { accordion: false, gap: 0 },
)

const model = defineModel<string | string[] | null>()

function openList(): string[] {
  const v = model.value
  return v == null ? [] : Array.isArray(v) ? v : [v]
}
function write(list: string[]) {
  model.value = props.accordion ? (list[list.length - 1] ?? null) : list
}

// Children run setup before the parent mounts, so every section present at first render seeds
// the state; a section that appears later (v-if) just reads it.
let seeding = model.value === undefined
onMounted(() => (seeding = false))

provide(SECTIONS_KEY, {
  isOpen: (value) => openList().includes(value),
  setOpen(value, open) {
    const rest = openList().filter((v) => v !== value)
    write(open ? (props.accordion ? [value] : [...rest, value]) : rest)
  },
  register(value, open) {
    if (!seeding || !open) return
    const list = openList()
    if (props.accordion ? list.length === 0 : !list.includes(value)) write([...list, value])
  },
})
</script>

<template>
  <div class="zen-sections" :style="{ gap: `${gap}px` }">
    <slot />
  </div>
</template>

<style scoped>
.zen-sections {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
</style>
