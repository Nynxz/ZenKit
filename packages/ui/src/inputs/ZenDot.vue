<script setup lang="ts">
import '../lib/motion.css'
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
  border-radius: var(--zen-dot-radius, var(--zen-radius, 7px));
  border: 1px solid var(--zen-border, #34343c);
  background: var(--zen-input, #1b1b20);
  transition: border-color var(--zen-dur-fast, 0.12s) ease;
}

/* The fill. It covers the frame exactly (the frame's border included) and takes the frame's radius
   as-is, so a percentage resolves against the same box; a transparent border of the frame's
   border plus the gap then insets it, and with the background clipped to inside that border the
   browser draws the fill's corners concentric with the frame's. At the 13px default that leaves a
   7px fill inside a 2px ring of background. (The frame's radius on a fill the fill's own size
   made it a dot in anything but a square frame.) */
.mark::after {
  content: '';
  position: absolute;
  inset: -1px;
  box-sizing: border-box;
  border: calc(1px + var(--zen-dot-gap, 2px)) solid transparent;
  border-radius: inherit;
  background-color: var(--zen-dot-on, var(--zen-accent, #6366f1));
  background-clip: padding-box;
  transform: scale(0);
  opacity: 0;
  transition:
    transform var(--zen-dur-fast, 0.12s) ease,
    opacity var(--zen-dur-fast, 0.12s) ease;
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

/* reduced motion: the OS setting, unless the host forces full motion; or the host's own
   data-zen-motion="reduce" (see lib/motion.css) */
@media (prefers-reduced-motion: reduce) {
  :global(:root:not([data-zen-motion='full'])) .mark,
  :global(:root:not([data-zen-motion='full'])) .mark::after {
    transition: none;
  }
}
:global(:root[data-zen-motion='reduce']) .mark,
:global(:root[data-zen-motion='reduce']) .mark::after {
  transition: none;
}
.zen-dot:focus-visible {
  outline: 2px solid
    var(--zen-focus-ring, color-mix(in srgb, var(--zen-accent, #6366f1) 60%, transparent));
  outline-offset: 1px;
  border-radius: var(--zen-radius, 7px);
}

.zen-dot:not(.on) .lbl {
  color: var(--zen-muted, #9aa0aa);
}
</style>
