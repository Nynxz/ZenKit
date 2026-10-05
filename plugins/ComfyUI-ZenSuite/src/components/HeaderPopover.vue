<template>
  <ZenPopover
    :open="state.open"
    :anchor="state.anchor"
    placement="bottom-end"
    :offset="6"
    @update:open="(v: boolean) => emit('update:open', v)"
  >
    <div class="zhp">
      <component :is="content" v-bind="contentProps" />
    </div>
  </ZenPopover>
</template>

<script setup lang="ts">
// A node's settings in a popover off its header button, instead of a widget in its body —
// a body widget takes a share of the node's height whenever it is resized (ComfyUI's Nodes
// 2.0 stretches every DOM widget row), which a media preview should have to itself.
import type { Component } from 'vue'
import { ZenPopover } from '@nynxz/zenkit-ui'

defineProps<{
  content: Component
  contentProps: Record<string, unknown>
  state: { open: boolean; anchor: HTMLElement | { x: number; y: number } | null }
}>()
const emit = defineEmits<{ 'update:open': [open: boolean] }>()
</script>

<style scoped>
.zhp {
  min-width: 220px;
  padding: 8px;
}
</style>
