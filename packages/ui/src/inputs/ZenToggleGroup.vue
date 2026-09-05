<script setup lang="ts">
// ZenToggleGroup — segmented single-select (v-model). The themed replacement for
// the hand-rolled segmented controls (AssetBrowser roots/sort, MediaViewer mode).
type Val = string
defineProps<{
  modelValue: Val
  options: { value: Val; label?: string; icon?: string; title?: string }[]
}>()
const emit = defineEmits<{ 'update:modelValue': [Val] }>()
</script>

<template>
  <div class="zen-tg" role="tablist">
    <button
      v-for="o in options"
      :key="String(o.value)"
      class="zen-tg-b"
      :class="{ on: o.value === modelValue }"
      :title="o.title || o.label"
      role="tab"
      :aria-selected="o.value === modelValue"
      @click="emit('update:modelValue', o.value)"
    >
      <i v-if="o.icon" :class="o.icon" />
      <span v-if="o.label">{{ o.label }}</span>
    </button>
  </div>
</template>

<style scoped>
.zen-tg {
  display: inline-flex;
  border: 1px solid var(--zen-border, #3a3a44);
  border-radius: var(--zen-radius, 7px);
  overflow: hidden;
  background: var(--zen-surface, #202026);
}
.zen-tg-b {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 4px 9px;
  border: none;
  background: none;
  color: var(--zen-muted, #9aa0aa);
  font-size: 11px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition:
    background 0.1s ease,
    color 0.1s ease;
}
.zen-tg-b + .zen-tg-b {
  border-left: 1px solid var(--zen-border, #3a3a44);
}
.zen-tg-b:hover {
  color: var(--zen-text, #e5e5ea);
}
.zen-tg-b.on {
  background: color-mix(in srgb, var(--zen-accent, #3b82f6) 20%, transparent);
  color: var(--zen-accent, #3b82f6);
}
.zen-tg-b .mdi {
  font-size: 14px;
}
</style>
