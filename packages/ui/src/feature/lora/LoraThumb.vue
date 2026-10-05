<!-- The 40px (or 18px) tile that stands in for a LoRA: its sidecar preview, a placeholder cube
     when it has none, or a warning glyph when the name no longer exists on disk. Its own
     component because the three states and their fallbacks are repeated in the picker, the row
     and the browser, and a preview that 404s has to demote itself in all three.
     Hold Shift over it to peek; Shift+click opens the details view. -->
<template>
  <i
    v-if="missing"
    class="mdi mdi-alert lt warn"
    :class="{ sm }"
    :title="`LoRA not found on disk: ${name}`"
  />
  <img
    v-else-if="showImage"
    class="lt"
    :class="{ sm }"
    :src="lib.preview(name)"
    loading="lazy"
    v-on="peek"
    @error="onError"
  />
  <i v-else class="mdi mdi-cube-outline lt ph" :class="{ sm }" v-on="peek" />
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue'

import * as lib from './loraLibrary'
import { hoverEnd, hoverStart, openLoraDetail } from './loraOverlays'

const props = withDefaults(
  defineProps<{
    name: string
    /** 18px inline tile instead of the 40px list tile. */
    sm?: boolean
    /** Show the "not on disk" state. Off in the browser, where every name came FROM the disk. */
    checkMissing?: boolean
    /** Trust `previewable` strictly. The default is optimistic — see lib.hasThumb. */
    strict?: boolean
  }>(),
  { sm: false, checkMissing: false, strict: false },
)

const missing = computed(() => props.checkMissing && lib.isMissing(props.name))
const showImage = computed(
  () => !!props.name && (props.strict ? lib.hasPreview(props.name) : lib.hasThumb(props.name)),
)

let hovered: HTMLElement | null = null

const peek = {
  mouseenter(e: MouseEvent) {
    hovered = e.currentTarget as HTMLElement
    hoverStart(props.name, hovered, e.shiftKey)
  },
  mouseleave() {
    if (hovered) hoverEnd(hovered)
    hovered = null
  },
  // Shift+press is ours: keep it from dragging the node or opening the combo under it.
  pointerdown(e: PointerEvent) {
    if (e.shiftKey && props.name) e.stopPropagation()
  },
  click(e: MouseEvent) {
    if (!e.shiftKey || !props.name) return
    e.preventDefault()
    e.stopPropagation()
    openLoraDetail(props.name)
  },
}

onBeforeUnmount(() => peek.mouseleave())

function onError(e: Event) {
  lib.onThumbError(props.name)
  lib.onImageError(e)
}
</script>

<style scoped>
.lt {
  flex: none;
  box-sizing: border-box;
  width: 40px;
  height: 40px;
  object-fit: contain;
  border-radius: var(--zen-radius, 7px);
  background: var(--zen-input, #1b1b20);
  border: 1px solid var(--zen-border, #34343c);
}
.lt.sm {
  width: 18px;
  height: 18px;
  border-radius: var(--zen-radius, 7px);
}
.lt.ph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--zen-muted, #9aa0aa);
  font-size: 20px;
}
.lt.sm.ph {
  font-size: 11px;
}
.lt.warn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--zen-danger, #dc2626);
  background: color-mix(in srgb, var(--zen-danger, #dc2626) 14%, transparent);
  border-color: color-mix(in srgb, var(--zen-danger, #dc2626) 45%, transparent);
  font-size: 20px;
}
.lt.sm.warn {
  font-size: 12px;
}
</style>
