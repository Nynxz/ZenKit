<script setup lang="ts">
// ZenMaskEditor — the no-runtime fallback host for ZenMaskCanvas: wraps it in a ZenWindow
// (draggable/resizable/maximizable floating window). When the ZenKit runtime is present,
// consumers should instead host ZenMaskCanvas in a real ZenKit panel (minimize/restore/taskbar);
// this window is for when ZenKit isn't installed. `apply` does NOT close the window — the
// consumer drives `open`.
import { ZenWindow } from '@nynxz/zenkit-ui'
import ZenMaskCanvas from './ZenMaskCanvas.vue'
import type { MaskResult } from './types'

withDefaults(
  defineProps<{
    open: boolean
    src: string
    maskSrc?: string
    maskOnly?: boolean
    initialMaskFromAlpha?: boolean
    title?: string
  }>(),
  { initialMaskFromAlpha: true, maskOnly: false, title: 'Mask Editor' },
)
const emit = defineEmits<{ 'update:open': [boolean]; apply: [MaskResult] }>()
</script>

<template>
  <ZenWindow
    :open="open"
    :title="title"
    icon="mdi mdi-brush-variant"
    :width="1080"
    :height="800"
    :min-width="600"
    :min-height="460"
    @update:open="(v: boolean) => emit('update:open', v)"
  >
    <ZenMaskCanvas
      :src="src"
      :mask-src="maskSrc"
      :mask-only="maskOnly"
      :initial-mask-from-alpha="initialMaskFromAlpha"
      @apply="(r: MaskResult) => emit('apply', r)"
    />
  </ZenWindow>
</template>
