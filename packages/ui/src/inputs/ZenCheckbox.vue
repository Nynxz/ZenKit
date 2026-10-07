<script setup lang="ts">
import '../lib/motion.css'
// ZenCheckbox — themed checkbox (v-model:boolean). For menus, dropdowns and option
// lists where a switch would be too heavy. The tick uses --zen-accent-text so it stays
// legible on light-primary themes (same contrast rule as primary buttons).
withDefaults(defineProps<{ modelValue: boolean; label?: string; disabled?: boolean }>(), {
  disabled: false,
})
const emit = defineEmits<{ 'update:modelValue': [boolean] }>()
</script>

<template>
  <button
    type="button"
    class="zen-check"
    role="checkbox"
    :class="{ on: modelValue }"
    :aria-checked="modelValue"
    :disabled="disabled"
    @click="emit('update:modelValue', !modelValue)"
  >
    <span class="box"><i v-if="modelValue" class="mdi mdi-check" /></span>
    <span v-if="label || $slots.default" class="lbl">
      <slot>{{ label }}</slot>
    </span>
  </button>
</template>

<style scoped>
.zen-check {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--zen-text, #e5e5ea);
  font: inherit;
  font-size: 12px;
  padding: 0;
  text-align: left;
}
.zen-check:focus-visible {
  outline: none;
}
.zen-check:focus-visible .box {
  outline: 2px solid
    var(--zen-focus-ring, color-mix(in srgb, var(--zen-accent, #6366f1) 60%, transparent));
  outline-offset: 1px;
}
.zen-check:disabled {
  opacity: 0.5;
  cursor: default;
}
.box {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex: none;
  border: 1px solid var(--zen-border, #34343c);
  border-radius: min(var(--zen-radius, 7px), 6px);
  background: var(--zen-input, #1b1b20);
  color: var(--zen-accent-text, #fff);
  transition:
    background var(--zen-dur-fast, 0.12s) ease,
    border-color var(--zen-dur-fast, 0.12s) ease;
}
.zen-check.on .box {
  background: var(--zen-accent, #6366f1);
  border-color: var(--zen-accent, #6366f1);
}
.zen-check:hover:not(:disabled) .box {
  border-color: var(--zen-accent, #6366f1);
}
.box .mdi {
  font-size: 13px;
  line-height: 1;
}
.lbl {
  line-height: 1.2;
}
</style>
