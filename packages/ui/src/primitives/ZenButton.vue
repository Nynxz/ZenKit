<script setup lang="ts">
import '../lib/motion.css'
// ZenButton — themed button. Variants: default | primary | ghost | danger.
import { iconClass } from '../lib/icon'

withDefaults(
  defineProps<{
    variant?: 'default' | 'primary' | 'ghost' | 'danger'
    icon?: string
    block?: boolean
    /** `sm` is the 24px control height, `md` (default) 28px — shared by every ZenKit control. */
    size?: 'sm' | 'md'
    /** Same as size="sm". */
    sm?: boolean
    disabled?: boolean
  }>(),
  { variant: 'default', size: 'md', block: false, sm: false, disabled: false },
)
</script>

<template>
  <button
    type="button"
    class="zen-btn"
    :class="[variant, { block, sm: sm || size === 'sm' }]"
    :disabled="disabled"
  >
    <i v-if="icon" :class="iconClass(icon)" />
    <span v-if="$slots.default" class="lbl"><slot /></span>
  </button>
</template>

<style scoped>
.zen-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  box-sizing: border-box;
  height: var(--zen-control-h, 28px);
  padding: 0 12px;
  border-radius: var(--zen-radius, 7px);
  border: 1px solid var(--zen-control-border, var(--zen-border, #34343c));
  background: var(--zen-control-bg, var(--zen-surface, #202026));
  color: var(--zen-text, #e5e5ea);
  transition:
    border-color var(--zen-dur-fast, 0.12s) ease,
    background var(--zen-dur-fast, 0.12s) ease,
    color var(--zen-dur-fast, 0.12s) ease,
    filter var(--zen-dur-fast, 0.12s) ease;
}
.zen-btn:hover:not(:disabled) {
  border-color: var(--zen-control-hover-border, var(--zen-accent, #6366f1));
  background: var(--zen-control-hover-bg, var(--zen-control-bg));
}
.zen-btn:focus-visible {
  outline: 2px solid
    var(--zen-focus-ring, color-mix(in srgb, var(--zen-accent, #6366f1) 60%, transparent));
  outline-offset: 1px;
}
.zen-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.zen-btn .mdi {
  font-size: 15px;
}
.zen-btn.block {
  width: 100%;
}
.zen-btn.sm {
  height: var(--zen-control-h-sm, 24px);
  padding: 0 9px;
  font-size: 11px;
}
.zen-btn.primary {
  background: var(--zen-accent, #6366f1);
  border-color: var(--zen-accent, #6366f1);
  color: var(--zen-accent-text, #fff);
}
.zen-btn.primary:hover:not(:disabled) {
  filter: brightness(1.08);
}
.zen-btn.ghost {
  background: transparent;
  border-color: transparent;
}
.zen-btn.ghost:hover:not(:disabled) {
  background: color-mix(in srgb, var(--zen-text, #e5e5ea) 10%, transparent);
  border-color: transparent;
}
.zen-btn.danger:hover:not(:disabled) {
  background: var(--zen-danger, #dc2626);
  border-color: var(--zen-danger, #dc2626);
  color: var(--zen-danger-text, #fff);
}
</style>
