<template>
  <div class="zen-host">
    <!-- pointer trap so the cursor can't hit the graph during drag/resize -->
    <div
      v-if="store.state.interacting"
      class="shield"
      :style="{ cursor: store.state.interactCursor || 'default' }"
    />
    <div v-if="store.state.snap" class="snapprev" :style="snapStyle" />
    <!-- highlights the side a dragged panel would dock into -->
    <div v-if="dockDropStyle" class="dockprev" :style="dockDropStyle" />
    <!-- full-screen app (covers the graph + graph-edge chrome; panels/toasts/taskbar stay above) -->
    <ZenApp v-if="appStore.state.active.app" />
    <ZenPanel v-for="p in hostPanels" :key="p.id" :panel="p" />
    <ZenDock />
    <ZenJobToasts />
    <ZenTaskbar />
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onMounted, onBeforeUnmount, ref } from 'vue'
import ZenApp from './ZenApp.vue'
import ZenPanel from './ZenPanel.vue'
import ZenDock from './ZenDock.vue'
import ZenJobToasts from './ZenJobToasts.vue'
import ZenTaskbar from './ZenTaskbar.vue'
import { STORE_KEY, type PanelStore } from '../panelStore'
import { APP_STORE_KEY, type AppStore } from '../appStore'
import { computeDockLayout, RAIL } from '../tiling'

const store = inject(STORE_KEY) as PanelStore
const appStore = inject(APP_STORE_KEY) as AppStore
const hostPanels = computed(() => store.state.list.filter((p) => !p.inSidebar))

// computeDockLayout reads window size (non-reactive) — bump on resize.
const vpTick = ref(0)
const onResize = () => vpTick.value++
onMounted(() => window.addEventListener('resize', onResize))
onBeforeUnmount(() => window.removeEventListener('resize', onResize))

const layout = computed(() => {
  void vpTick.value
  return computeDockLayout(store)
})

const snapStyle = computed(() =>
  store.state.snap
    ? {
        left: store.state.snap.x + 'px',
        top: store.state.snap.y + 'px',
        width: store.state.snap.w + 'px',
        height: store.state.snap.h + 'px',
      }
    : {},
)

// Highlight the target dock zone (or a default band if that side is empty).
const dockDropStyle = computed(() => {
  const side = store.state.dockDrop
  if (!side) return null
  void vpTick.value
  const W = window.innerWidth
  const H = window.innerHeight
  const zone = layout.value[side]
  const span = zone.reserve || (side === 'bottom' ? RAIL + 280 : RAIL + 300)
  if (side === 'left') return { left: '0', top: '0', width: span + 'px', height: '100%' }
  if (side === 'right')
    return { left: W - span + 'px', top: '0', width: span + 'px', height: '100%' }
  return { left: '0', top: H - span + 'px', width: '100%', height: span + 'px' }
})
</script>

<style scoped>
.zen-host {
  position: fixed;
  inset: 0;
  z-index: 1500;
  pointer-events: none;
}
.zen-host > * {
  pointer-events: auto;
}
/* above graph, below panels: swallows pointer events mid-drag */
.shield {
  position: fixed;
  inset: 0;
  z-index: 1;
  background: transparent;
}
.snapprev {
  position: fixed;
  pointer-events: none;
  border-radius: var(--zen-radius, 10px);
  background: color-mix(in srgb, var(--zen-accent, #3b82f6) 18%, transparent);
  border: 2px solid var(--zen-accent, #3b82f6);
  transition:
    left 0.09s,
    top 0.09s,
    width 0.09s,
    height 0.09s;
}
.dockprev {
  position: fixed;
  pointer-events: none;
  z-index: 9;
  background: color-mix(in srgb, var(--zen-accent, #3b82f6) 14%, transparent);
  border: 2px dashed var(--zen-accent, #3b82f6);
  transition:
    left 0.09s,
    top 0.09s,
    width 0.09s,
    height 0.09s;
}
</style>
