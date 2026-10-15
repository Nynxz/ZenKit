<template>
  <div ref="host" class="bm" :class="{ fill: target.widget.zenMirror?.fill }" />
</template>

<script setup lang="ts">
/** A ZenKit widget shown as itself — the pack's own component, a second view kept in step with
 *  the one on its node. A widget that fills its node gets a resizable box here. */
import { onBeforeUnmount, onMounted, ref } from 'vue'

import type { Target } from './store'

const props = defineProps<{ target: Target }>()
const host = ref<HTMLElement | null>(null)
let unmount: (() => void) | undefined

onMounted(() => {
  if (host.value) unmount = props.target.widget.zenMirror?.mount(host.value)
})
onBeforeUnmount(() => unmount?.())
</script>

<style scoped>
.bm {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.bm.fill {
  height: 320px;
  min-height: 160px;
  overflow: hidden;
  resize: vertical;
}
</style>
