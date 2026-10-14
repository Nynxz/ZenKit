<script setup lang="ts">
// ZenEmpty — the "nothing here yet" state for a panel or list: a faint mark, an optional
// title, a line of guidance (default slot) and an optional `actions` slot. The mark is ZenKit's
// lotus in one colour unless `icon` (MDI class or image URL) names something more specific.
// Centres itself in whatever flex/grid parent it sits in.
import ZenIcon from './ZenIcon.vue'
import ZenLotus from './ZenLotus.vue'

defineProps<{ title?: string; icon?: string }>()
</script>

<template>
  <div class="zen-empty" role="status">
    <ZenIcon v-if="icon" class="zen-empty-mark zen-empty-icon" :icon="icon" />
    <ZenLotus v-else class="zen-empty-mark" water />
    <div v-if="title" class="zen-empty-title">{{ title }}</div>
    <p v-if="$slots.default" class="zen-empty-text"><slot /></p>
    <div v-if="$slots.actions" class="zen-empty-actions"><slot name="actions" /></div>
  </div>
</template>

<style scoped>
.zen-empty {
  margin: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  max-width: 260px;
  padding: 20px;
  text-align: center;
  color: var(--zen-muted, #9aa0aa);
  font-family: var(--p-font-family, system-ui, sans-serif);
}
.zen-empty-mark {
  width: 44px;
  margin-bottom: 4px;
  fill: currentColor;
  opacity: 0.45;
}
.zen-empty-icon {
  width: auto;
  font-size: 36px;
}
.zen-empty-title {
  color: var(--zen-text, #e5e5ea);
  font-size: 13px;
  font-weight: 600;
}
.zen-empty-text {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
}
.zen-empty-actions {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}
</style>
