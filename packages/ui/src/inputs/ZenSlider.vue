<script setup lang="ts">
// ZenSlider — themed range input (v-model). A thin track + accent thumb; pairs with
// ZenNumber for "slider + readout" rows (brush size/opacity/hardness, etc.).
withDefaults(
  defineProps<{
    modelValue: number
    min?: number
    max?: number
    step?: number
    disabled?: boolean
  }>(),
  { min: 0, max: 100, step: 1, disabled: false },
)
const emit = defineEmits<{ 'update:modelValue': [number] }>()
function onInput(e: Event) {
  const v = Number((e.target as HTMLInputElement).value)
  if (Number.isFinite(v)) emit('update:modelValue', v)
}
</script>

<template>
  <input
    class="zen-slider"
    type="range"
    :min="min"
    :max="max"
    :step="step"
    :value="modelValue"
    :disabled="disabled"
    @input="onInput"
  />
</template>

<style scoped>
.zen-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 4px;
  border-radius: var(--zen-radius, 999px);
  background: var(--zen-border, #34343c);
  outline: none;
  cursor: pointer;
}
.zen-slider:disabled {
  opacity: 0.5;
  cursor: default;
}
.zen-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: var(--zen-radius, 50%);
  background: var(--zen-accent, #6366f1);
  border: 2px solid var(--zen-bg, #1a1a1f);
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
}
.zen-slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border: 2px solid var(--zen-bg, #1a1a1f);
  border-radius: var(--zen-radius, 50%);
  background: var(--zen-accent, #6366f1);
  cursor: pointer;
}
.zen-slider::-moz-range-track {
  height: 4px;
  border-radius: var(--zen-radius, 999px);
  background: var(--zen-border, #34343c);
}
.zen-slider:focus-visible {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--zen-accent, #6366f1) 50%, transparent);
}
</style>
