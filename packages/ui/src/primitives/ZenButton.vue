<script setup lang="ts">
// ZenButton — themed button. Variants: default | primary | ghost | danger.
withDefaults(
  defineProps<{
    variant?: 'default' | 'primary' | 'ghost' | 'danger'
    icon?: string
    block?: boolean
    sm?: boolean
    disabled?: boolean
  }>(),
  { variant: 'default', block: false, sm: false, disabled: false },
)
</script>

<template>
  <button class="zen-btn" :class="[variant, { block, sm }]" :disabled="disabled">
    <i v-if="icon" :class="icon" />
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
  padding: 7px 12px;
  border-radius: var(--zen-radius, 8px);
  border: 1px solid var(--zen-border, #3a3a44);
  background: var(--zen-surface, #202026);
  color: var(--zen-text, #e5e5ea);
  transition:
    border-color 0.12s ease,
    background 0.12s ease,
    color 0.12s ease,
    filter 0.12s ease;
}
.zen-btn:hover:not(:disabled) {
  border-color: var(--zen-accent, #3b82f6);
}
.zen-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.zen-btn .mdi {
  font-size: 15px;
}
.zen-btn.block {
  width: 100%;
}
.zen-btn.sm {
  padding: 5px 9px;
  font-size: 11px;
}
.zen-btn.primary {
  background: var(--zen-accent, #3b82f6);
  border-color: var(--zen-accent, #3b82f6);
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
  background: color-mix(in srgb, var(--zen-text, #fff) 10%, transparent);
  border-color: transparent;
}
.zen-btn.danger:hover:not(:disabled) {
  background: #b91c1c;
  border-color: #b91c1c;
  color: #fff;
}
</style>
