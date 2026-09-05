<script setup lang="ts">
// ZenScroll — scroll container with themed scrollbars (works anywhere, not just inside a
// panel). Scrollbar look comes from the shared .zen-scroll stylesheet so it's identical
// everywhere it's used (including teleported menus/dialogs).
import '../lib/scrollbar.css'
withDefaults(defineProps<{ horizontal?: boolean }>(), { horizontal: false })
</script>

<template>
  <div class="zen-scroll" :class="{ x: horizontal }"><slot /></div>
</template>

<style scoped>
/* layout only — scrollbar styling lives in scrollbar.css (.zen-scroll, global) */
.zen-scroll {
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}
.zen-scroll.x {
  overflow-x: auto;
  overflow-y: hidden;
}
</style>
