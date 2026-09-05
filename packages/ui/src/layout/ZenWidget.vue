<script setup lang="ts">
// The outer shell for a node-body widget: flex column, gap, padding, box-sizing, and the
// `height: 100%; min-height: 0` pair fill-mode widgets need.
//
// It also resets the cursor. ComfyUI's node element carries `cursor-grab`, and `cursor`
// inherits — so without this every gap in a widget shows a grabbing hand over content that
// isn't draggable.
//
// `fill` must match the widget's registration: a `fill: true` widget is sized by the node and
// needs `<ZenWidget fill>`; a content-sized one must not have it, or a height:100% root has
// nothing to resolve against and the node grows without bound.
import { ref } from 'vue'

withDefaults(
  defineProps<{
    /** Match the widget's `fill` registration: fills the node body instead of hugging content. */
    fill?: boolean
    /** Gap between stacked sections, in px. */
    gap?: number
    /** Body padding. `true` = the default, `false` = none, a number = that many px vertically,
     *  or any CSS padding string for an exact value.
     *
     *  The string form exists because real panels had drifted to seven different paddings, and
     *  adopting this component shouldn't quietly restyle them. Pass the exact value while
     *  migrating; normalise to the default later, deliberately, when you can see the result. */
    pad?: boolean | number | string
    /** For `dragThrough` widgets: keep the node's grab cursor, because here a press DOES drag
     *  the node. Without this a visual-only body would deny an affordance it actually has. */
    dragThrough?: boolean
  }>(),
  { fill: false, gap: 7, pad: true, dragThrough: false },
)

// Exposed because a `ref` on a COMPONENT resolves to its instance, not its element — so a caller
// that needs the DOM node (e.g. `addNodeHeaderButton`, which walks up from any element inside the
// node to find its header) would otherwise silently get a proxy with no `querySelector` and fail
// with no error. Consumers read `shell.value?.el`.
const el = ref<HTMLElement | null>(null)
defineExpose({ el })
</script>

<template>
  <div
    ref="el"
    class="zen-widget"
    :class="{ fill, 'drag-through': dragThrough }"
    :style="{
      gap: `${gap}px`,
      ...(pad === false
        ? { padding: '0' }
        : typeof pad === 'number'
          ? { padding: `${pad}px 2px` }
          : typeof pad === 'string'
            ? { padding: pad }
            : {}),
    }"
  >
    <slot />
  </div>
</template>

<style scoped>
.zen-widget {
  display: flex;
  flex-direction: column;
  width: 100%;
  padding: 6px 2px;
  box-sizing: border-box;
  /* The reason this component exists — see the header. Interactive children still set their own
     (a drag surface wants ew-resize, a button wants pointer); this only governs the gaps. */
  cursor: default;
  /* Baseline typography so a panel doesn't inherit whatever the node header is using. Both are
     theme tokens, so they follow the user's ComfyUI theme through comfy-bridge.css. */
  font-size: 12px;
  color: var(--zen-text, #e5e5ea);
}

/* Sized by the node: fill it and allow children to shrink. `min-height: 0` is the load-bearing
   half — without it a flex child's intrinsic height wins and the body overflows instead of
   fitting. */
.zen-widget.fill {
  height: 100%;
  min-height: 0;
}

/* A visual-only body: the press belongs to the node, so keep the node's own cursor. */
.zen-widget.drag-through {
  cursor: inherit;
}
</style>
