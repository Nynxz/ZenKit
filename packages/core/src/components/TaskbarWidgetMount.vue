<script setup lang="ts">
// Mounts one taskbar widget: hands it a host element on mount, runs its cleanup on unmount.
import { ref, onMounted, onBeforeUnmount } from 'vue'
import type { TaskbarWidget } from '../types'

const props = defineProps<{ widget: TaskbarWidget }>()
const el = ref<HTMLElement | null>(null)
let cleanup: (() => void) | void
onMounted(() => {
  if (el.value) cleanup = props.widget.render(el.value)
})
onBeforeUnmount(() => cleanup?.())
</script>

<template>
  <div ref="el" class="tb-widget" :title="widget.label"></div>
</template>

<style scoped>
.tb-widget {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 100%;
  color: var(--zen-text, #e5e5ea);
  font-size: 12px;
}
</style>
