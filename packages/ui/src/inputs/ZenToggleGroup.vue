<script setup lang="ts">
// ZenToggleGroup — segmented single-select (v-model). The themed replacement for
// the hand-rolled segmented controls (AssetBrowser roots/sort, MediaViewer mode).
// `collapse`: options show only their icon, and the selected one slides open to show its label —
// a compact switch that still says where you are.
import { iconClass } from '../lib/icon'

type Val = string
defineProps<{
  modelValue: Val
  options: { value: Val; label?: string; icon?: string; title?: string }[]
  collapse?: boolean
  disabled?: boolean
  /** `sm` 24px, `md` (default) 28px — the shared control heights. */
  size?: 'sm' | 'md'
}>()
const emit = defineEmits<{ 'update:modelValue': [Val] }>()
</script>

<template>
  <div
    class="zen-tg"
    :class="{ 'zen-tg-collapse': collapse, sm: size === 'sm', disabled }"
    role="tablist"
  >
    <button
      v-for="o in options"
      :key="String(o.value)"
      type="button"
      class="zen-tg-b"
      :class="{ on: o.value === modelValue }"
      :title="o.title || o.label"
      role="tab"
      :aria-selected="o.value === modelValue"
      :disabled="disabled"
      @click="emit('update:modelValue', o.value)"
    >
      <i v-if="o.icon" :class="iconClass(o.icon)" />
      <span v-if="o.label" class="zen-tg-l">
        <span>{{ o.label }}</span>
      </span>
    </button>
  </div>
</template>

<style scoped>
.zen-tg.sm {
  height: var(--zen-control-h-sm, 24px);
}
.zen-tg.disabled {
  opacity: 0.45;
}
.zen-tg.disabled .zen-tg-b {
  cursor: not-allowed;
}
.zen-tg {
  display: inline-flex;
  box-sizing: border-box;
  height: var(--zen-control-h, 28px);
  border: 1px solid var(--zen-control-border, var(--zen-border, #34343c));
  border-radius: var(--zen-radius, 7px);
  overflow: hidden;
  background: var(--zen-control-bg, var(--zen-surface, #202026));
}
.zen-tg-b {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 0 9px;
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
  border-left: 1px solid var(--zen-border, #34343c);
}
.zen-tg-b:focus-visible {
  /* inset: the group clips its overflow for the rounded ends */
  outline: 2px solid
    var(--zen-focus-ring, color-mix(in srgb, var(--zen-accent, #6366f1) 60%, transparent));
  outline-offset: -2px;
}
.zen-tg-b:hover {
  color: var(--zen-text, #e5e5ea);
}
.zen-tg-b.on {
  background: color-mix(in srgb, var(--zen-accent, #6366f1) 20%, transparent);
  color: var(--zen-accent, #6366f1);
}
.zen-tg-b .mdi {
  font-size: 14px;
}
/* collapse: icon-only until selected; the selected label slides open. The grid-track trick
   animates to the label's natural width without measuring it. */
.zen-tg.zen-tg-collapse .zen-tg-b {
  gap: 0;
  padding: 4px 7px;
  transition:
    background 0.18s ease,
    color 0.18s ease,
    gap 0.22s ease;
}
.zen-tg.zen-tg-collapse .zen-tg-l {
  display: inline-grid;
  grid-template-columns: 0fr;
  overflow: hidden;
  opacity: 0;
  white-space: nowrap;
  transition:
    grid-template-columns 0.22s ease,
    opacity 0.18s ease;
}
.zen-tg.zen-tg-collapse .zen-tg-l > span {
  min-width: 0;
  overflow: hidden;
}
.zen-tg.zen-tg-collapse .zen-tg-b.on {
  gap: 5px;
  padding: 4px 9px 4px 8px;
}
.zen-tg.zen-tg-collapse .zen-tg-b.on .zen-tg-l {
  grid-template-columns: 1fr;
  opacity: 1;
}
@media (prefers-reduced-motion: reduce) {
  .zen-tg.zen-tg-collapse .zen-tg-b,
  .zen-tg.zen-tg-collapse .zen-tg-l {
    transition: none;
  }
}
</style>
