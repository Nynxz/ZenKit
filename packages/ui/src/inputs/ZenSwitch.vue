<script setup lang="ts">
// ZenSwitch — boolean toggle (v-model), optional on/off mdi icons.
import { iconClass } from '../lib/icon'

withDefaults(
  defineProps<{ modelValue: boolean; onIcon?: string; offIcon?: string; disabled?: boolean }>(),
  { disabled: false },
)
const emit = defineEmits<{ 'update:modelValue': [boolean] }>()
</script>

<template>
  <button
    type="button"
    class="zen-switch"
    role="switch"
    :class="{ on: modelValue }"
    :aria-checked="modelValue"
    :disabled="disabled"
    @click="emit('update:modelValue', !modelValue)"
  >
    <span class="knob">
      <i v-if="onIcon || offIcon" :class="iconClass(modelValue ? onIcon : offIcon)" />
    </span>
  </button>
</template>

<style scoped>
/* radius follows the theme's rounding token (--zen-radius, bridged from --radius), so
   square/straight-edge themes like Mecha get a square toggle. Falls back to a pill +
   round knob; override just the switch with --zen-switch-radius if needed. */
.zen-switch {
  position: relative;
  flex: 0 0 auto;
  width: 42px;
  height: 23px;
  padding: 0;
  border: 1px solid var(--zen-border, #34343c);
  border-radius: var(--zen-switch-radius, var(--zen-radius, 7px));
  background: var(--zen-surface, #202026);
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease;
}
.zen-switch.on {
  background: var(--zen-accent, #6366f1);
  border-color: var(--zen-accent, #6366f1);
}
.zen-switch:disabled {
  opacity: 0.5;
  cursor: default;
}
.zen-switch .knob {
  position: absolute;
  top: 1px;
  left: 1px;
  width: 19px;
  height: 19px;
  border-radius: var(--zen-switch-radius, var(--zen-radius, 7px));
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.15s ease;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
}
.zen-switch.on .knob {
  transform: translateX(19px);
  background: var(--zen-accent-text, #fff);
}
.zen-switch:focus-visible {
  outline: 2px solid
    var(--zen-focus-ring, color-mix(in srgb, var(--zen-accent, #6366f1) 60%, transparent));
  outline-offset: 1px;
}
.zen-switch .knob .mdi {
  font-size: 12px;
  color: var(--zen-muted, #9aa0aa);
}
.zen-switch.on .knob .mdi {
  color: var(--zen-accent, #6366f1);
}
</style>
