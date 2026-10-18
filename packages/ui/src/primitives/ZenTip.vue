<script setup lang="ts">
// ZenTip — an ⓘ that explains the thing beside it, so help text needn't sit under every field.
// Hover or keyboard focus opens it, leaving or Escape closes it; it's a real button, so Tab
// reaches it and a screen reader reads the text (aria-describedby). The bubble is a ZenPopover
// with role tooltip: teleported, viewport-aware, never clipped by a panel.
// With slot content the words themselves are the trigger instead of the ⓘ — <ZenTip text="…">
// Validation</ZenTip> — plain text at rest (a dotted underline on hover), opening after a short
// hover (`delay`, default 450 ms there) so it doesn't fire as the pointer passes over.
import { computed, ref, useId, useSlots } from 'vue'
import ZenPopover from '../overlays/ZenPopover.vue'

const props = defineProps<{ text: string; label?: string; delay?: number }>()
const slots = useSlots()
const inline = computed(() => !!slots.default)
const wait = computed(() => props.delay ?? (inline.value ? 450 : 0))

const btn = ref<HTMLElement | null>(null)
const open = ref(false)
const id = useId()
let leave: ReturnType<typeof setTimeout> | undefined
let enter: ReturnType<typeof setTimeout> | undefined
// the bubble ignores the pointer (ZenPopover's tooltip role): leaving the trigger closes it
const show = () => {
  clearTimeout(leave)
  if (open.value) return
  clearTimeout(enter)
  if (wait.value) enter = setTimeout(() => (open.value = true), wait.value)
  else open.value = true
}
const showNow = () => {
  clearTimeout(enter)
  clearTimeout(leave)
  open.value = true
}
const hide = () => {
  clearTimeout(enter)
  clearTimeout(leave)
  leave = setTimeout(() => (open.value = false), 80)
}
</script>

<template>
  <button
    ref="btn"
    type="button"
    class="zen-tip"
    :class="{ inline }"
    :aria-label="inline ? undefined : (label ?? 'More about this')"
    :aria-describedby="open ? id : undefined"
    @mouseenter="show"
    @mouseleave="hide"
    @focus="showNow"
    @blur="hide"
    @keydown.esc="open = false"
    @click.prevent="open = !open"
  >
    <slot v-if="inline" />
    <svg v-else viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.4" />
      <path d="M8 7.2v3.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      <circle cx="8" cy="5" r="0.9" fill="currentColor" />
    </svg>
  </button>
  <ZenPopover v-model:open="open" :anchor="btn" placement="top-start" :offset="6" role="tooltip">
    <div :id="id" class="zen-tip-body">{{ text }}</div>
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
.zen-tip.inline {
  display: inline;
  width: auto;
  height: auto;
  font: inherit;
  color: inherit;
  text-align: inherit;
  text-decoration: underline dotted transparent;
  text-underline-offset: 3px;
  transition: text-decoration-color 0.15s ease;
}
.zen-tip.inline:hover,
.zen-tip.inline:focus-visible {
  color: inherit;
  text-decoration-color: color-mix(in srgb, currentColor 55%, transparent);
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
