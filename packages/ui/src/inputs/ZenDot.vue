<script setup lang="ts">
// The most compact boolean: a small coloured shape, filled when on, hollow when off.
//
// Pick by how much the control should assert itself — ZenSwitch (42x23 pill) for a setting,
// ZenCheckbox for an option in a list, ZenDot for on/off state in a repeated row.
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    /** Fill colour when on. Defaults to the theme accent; set it per-row to colour-code state. */
    color?: string
    /** Optional text beside the dot. */
    label?: string
    disabled?: boolean
  }>(),
  { disabled: false },
)
const emit = defineEmits<{ 'update:modelValue': [boolean] }>()

// Routed through a custom property so one binding tints the fill, the container outline and
// the hover state together — inline-styling the mark could only reach the outer shape, and
// the fill is a pseudo-element.
const vars = computed<Record<string, string> | undefined>(() =>
  props.color ? { '--zen-dot-on': props.color } : undefined,
)
</script>

<template>
  <button
    type="button"
    class="zen-dot"
    role="checkbox"
    :class="{ on: modelValue }"
    :aria-checked="modelValue"
    :disabled="disabled"
    @click="emit('update:modelValue', !modelValue)"
  >
    <span class="mark" :style="vars" />
    <span v-if="label || $slots.default" class="lbl">
      <slot>{{ label }}</slot>
    </span>
  </button>
</template>

<style scoped>
.zen-dot {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  /* Padding, not margin: it grows the CLICK TARGET without adding layout space around the
     control, so rows stay tight while the dot stays easy to hit. */
  padding: 4px;
  margin: -4px;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--zen-text, #e5e5ea);
  font: inherit;
  font-size: 12px;
  line-height: 1.2;
}
.zen-dot:disabled {
  opacity: 0.4;
  cursor: default;
}

/* The container. Its border and background are the SAME in both states — it's the frame the
   fill is judged against, so it must not move when the value changes. */
.mark {
  position: relative;
  display: inline-block;
  flex: none;
  width: var(--zen-dot-size, 13px);
  height: var(--zen-dot-size, 13px);
  /* Follows the theme's rounding token like ZenSwitch does, so square-edged themes get a
     square mark. Override just this control with --zen-dot-radius. */
  border-radius: var(--zen-dot-radius, var(--zen-radius, 50%));
  border: 1px solid var(--zen-border, #3a3a44);
  background: var(--zen-input, #1b1b20);
  transition: border-color 0.12s ease;
}

/* The fill. Absolutely positioned, so `inset` measures from inside the border and the gap
   holds at any --zen-dot-size without recomputing anything. At the 13px default that leaves
   a 7px fill inside a 2px ring of background. `border-radius: inherit` keeps a round theme
   round and a square theme square. */
.mark::after {
  content: '';
  position: absolute;
  inset: var(--zen-dot-gap, 2px);
  border-radius: inherit;
  background: var(--zen-dot-on, var(--zen-accent, #6366f1));
  transform: scale(0);
  opacity: 0;
  transition:
    transform 0.12s ease,
    opacity 0.12s ease;
}
.zen-dot.on .mark {
  border-color: var(--zen-dot-on, var(--zen-accent, #6366f1));
}
.zen-dot.on .mark::after {
  transform: scale(1);
  opacity: 1;
}

/* Off state still responds, so it never reads as disabled. The ghost fill shows where the
   value is about to land — the whole point of keeping the frame visible. */
.zen-dot:hover:not(:disabled) .mark {
  border-color: var(--zen-dot-on, var(--zen-accent, #6366f1));
}
.zen-dot:hover:not(:disabled):not(.on) .mark::after {
  transform: scale(1);
  opacity: 0.22;
}

@media (prefers-reduced-motion: reduce) {
  .mark,
  .mark::after {
    transition: none;
  }
}
.zen-dot:focus-visible {
  outline: 1px solid var(--zen-accent, #6366f1);
  outline-offset: 1px;
  border-radius: var(--zen-radius, 4px);
}

.zen-dot:not(.on) .lbl {
  color: var(--zen-muted, #9aa0aa);
}
</style>
