<script setup lang="ts">
// ZenTip — an ⓘ that explains the thing beside it, so help text needn't sit under every field.
// Hover or keyboard focus opens it, leaving or Escape closes it; it's a real button, so Tab
// reaches it and a screen reader reads the text (aria-describedby). The bubble is a ZenPopover
// with role tooltip: teleported, viewport-aware, never clipped by a panel.
import { ref, useId } from 'vue'
import ZenPopover from '../overlays/ZenPopover.vue'

defineProps<{ text: string; label?: string }>()

const btn = ref<HTMLElement | null>(null)
const open = ref(false)
const id = useId()
let leave: ReturnType<typeof setTimeout> | undefined
// a short grace period, so the pointer can cross the gap without the tip flickering
const show = () => {
  clearTimeout(leave)
  open.value = true
}
const hide = () => {
  clearTimeout(leave)
  leave = setTimeout(() => (open.value = false), 80)
}
</script>

<template>
  <button
    ref="btn"
    type="button"
    class="zen-tip"
    :aria-label="label ?? 'More about this'"
    :aria-describedby="open ? id : undefined"
    @mouseenter="show"
    @mouseleave="hide"
    @focus="show"
    @blur="hide"
    @keydown.esc="open = false"
    @click.prevent="open = !open"
  >
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.4" />
      <path d="M8 7.2v3.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      <circle cx="8" cy="5" r="0.9" fill="currentColor" />
    </svg>
  </button>
  <ZenPopover v-model:open="open" :anchor="btn" placement="top-start" :offset="6" role="tooltip">
    <div :id="id" class="zen-tip-body" @mouseenter="show" @mouseleave="hide">{{ text }}</div>
  </ZenPopover>
</template>

<style scoped>
.zen-tip {
  display: inline-grid;
  place-items: center;
  width: 16px;
  height: 16px;
  padding: 0;
  margin: 0;
  border: none;
  background: none;
  color: var(--zen-muted, #9aa0aa);
  cursor: help;
  border-radius: var(--zen-radius, 6px);
  flex: none;
  vertical-align: middle;
}
.zen-tip svg {
  width: 13px;
  height: 13px;
}
.zen-tip:hover,
.zen-tip:focus-visible {
  color: var(--zen-accent, #8ab4ff);
}
.zen-tip:focus-visible {
  outline: 2px solid var(--zen-accent, #8ab4ff);
  outline-offset: 1px;
}
.zen-tip-body {
  max-width: 280px;
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--zen-text, #e5e5ea);
  white-space: normal;
}
</style>
