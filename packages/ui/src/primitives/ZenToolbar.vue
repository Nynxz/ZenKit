<script setup lang="ts">
// ZenToolbar — a panel header bar. `start` slot sits after the title; default slot is right-aligned.
defineProps<{ title?: string; icon?: string }>()
</script>

<template>
  <div class="zen-toolbar">
    <i v-if="icon" class="tb-icon" :class="icon" />
    <span v-if="title" class="tb-title">{{ title }}</span>
    <slot name="start" />
    <span class="tb-grow" />
    <slot />
  </div>
</template>

<style scoped>
.zen-toolbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 9px;
  border-bottom: 1px solid var(--zen-border, #3a3a44);
  background: var(--zen-surface, #202026);
}
.tb-icon {
  font-size: 15px;
  color: var(--zen-accent, #3b82f6);
}
.tb-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--zen-text, #e5e5ea);
  white-space: nowrap;
}
.tb-grow {
  flex: 1;
}
</style>
