<script setup lang="ts">
// ZenView — standard panel layout: fills the panel body the right way (flex column,
// height:100% — never absolute/inset), with `toolbar`/`footer` slots and a body that
// scrolls by default. Set :scroll="false" for fill panels (canvas/games); :pad="false"
// to drop the body padding.
import ZenScroll from './ZenScroll.vue'

withDefaults(defineProps<{ scroll?: boolean; pad?: boolean }>(), { scroll: true, pad: true })
</script>

<template>
  <div class="zen-view">
    <slot name="toolbar" />
    <ZenScroll v-if="scroll" class="zen-view-body" :class="{ pad }"><slot /></ZenScroll>
    <div v-else class="zen-view-body fill" :class="{ pad }"><slot /></div>
    <slot name="footer" />
  </div>
</template>

<style scoped>
.zen-view {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--zen-bg, #1a1a1f);
  color: var(--zen-text, #e5e5ea);
  font-family: var(--p-font-family, system-ui, sans-serif);
}
.zen-view-body {
  flex: 1 1 0;
  min-height: 0;
}
.zen-view-body.fill {
  display: flex;
}
.zen-view-body.pad {
  padding: 10px;
}
</style>
