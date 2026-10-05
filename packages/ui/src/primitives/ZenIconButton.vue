<script setup lang="ts">
// ZenIconButton — compact icon-only button (panel headers, toolbars). Icon-only, so its
// accessible name falls back to the `title` attribute when no aria-label is given.
import { useAttrs } from 'vue'
import { iconClass } from '../lib/icon'

withDefaults(
  defineProps<{
    icon: string
    danger?: boolean
    active?: boolean
    disabled?: boolean
    /** `sm` 24px square, `md` (default) 28px: the shared control heights. */
    size?: 'sm' | 'md'
  }>(),
  { danger: false, active: false, disabled: false, size: 'md' },
)
const attrs = useAttrs()
</script>

<template>
  <button
    type="button"
    class="zen-iconbtn"
    :class="{ danger, active, sm: size === 'sm' }"
    :disabled="disabled"
    :aria-label="(attrs['aria-label'] as string | undefined) ?? (attrs.title as string | undefined)"
  >
    <i :class="iconClass(icon)" />
  </button>
</template>

<style scoped>
.zen-iconbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  box-sizing: border-box;
  width: var(--zen-control-h, 28px);
  height: var(--zen-control-h, 28px);
  border: 1px solid transparent;
  border-radius: var(--zen-radius, 7px);
  background: none;
  color: var(--zen-muted, #9aa0aa);
  cursor: pointer;
  transition:
    background 0.1s ease,
    color 0.1s ease;
}
.zen-iconbtn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--zen-text, #e5e5ea) 12%, transparent);
  color: var(--zen-text, #e5e5ea);
}
.zen-iconbtn.active {
  color: var(--zen-accent, #6366f1);
}
.zen-iconbtn.danger:hover:not(:disabled) {
  background: var(--zen-danger, #dc2626);
  color: var(--zen-danger-text, #fff);
}
.zen-iconbtn:focus-visible {
  outline: 2px solid
    var(--zen-focus-ring, color-mix(in srgb, var(--zen-accent, #6366f1) 60%, transparent));
  outline-offset: 1px;
}
.zen-iconbtn.sm {
  width: var(--zen-control-h-sm, 24px);
  height: var(--zen-control-h-sm, 24px);
}
.zen-iconbtn:disabled {
  cursor: not-allowed;
  opacity: 0.4;
  cursor: default;
}
.zen-iconbtn .mdi {
  font-size: 16px;
}
</style>
