<template>
  <div class="zen-host">
    <!-- pointer trap so the cursor can't hit the graph or another panel during drag/resize -->
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
    <!-- the active workspace: covers the graph and tiles panels; null = the graph itself -->
    <ZenWorkspace v-if="ws.active" />
    <ZenPanel v-for="p in hostPanels" :key="p.id" :panel="p" />
    <ZenDock />
    <ZenTaskbar />
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onMounted, onBeforeUnmount, ref } from 'vue'
import ZenApp from './ZenApp.vue'
import ZenWorkspace from './ZenWorkspace.vue'
import ZenPanel from './ZenPanel.vue'
import ZenDock from './ZenDock.vue'
import ZenTaskbar from './ZenTaskbar.vue'
import { STORE_KEY, type PanelStore } from '../panelStore'
import { APP_STORE_KEY, type AppStore } from '../appStore'
import { dockBounds, RAIL } from '../tiling'
import { sidebarRail } from '../dockDrop'
import { ws } from '../workspaces'

const store = inject(STORE_KEY) as PanelStore
const appStore = inject(APP_STORE_KEY) as AppStore
const hostPanels = computed(() => store.state.list.filter((p) => !p.inSidebar))

// computeDockLayout reads window size (non-reactive) — bump on resize.
const vpTick = ref(0)
const onResize = () => vpTick.value++
onMounted(() => window.addEventListener('resize', onResize))
onBeforeUnmount(() => window.removeEventListener('resize', onResize))

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
const SIDEBAR_PANEL_W = 312 // ComfyUI's sidebar panel minimum (min-w-78)

// The card the dragged panel would become: beside ComfyUI's sidebar rail, as the right dock,
// or rising above the taskbar.
const dockDropStyle = computed(() => {
  const target = store.state.dockDrop
  if (!target) return null
  void vpTick.value
  const px = (x: number, y: number, w: number, h: number) => ({
    left: x + 'px',
    top: y + 'px',
    width: w + 'px',
    height: h + 'px',
  })
  const { L, R, T, B, g } = dockBounds(store)
  if (target === 'sidebar') {
    const rail = sidebarRail()?.getBoundingClientRect()
    const x = rail ? rail.right : L + g
    return px(x, T + g, SIDEBAR_PANEL_W, B - T - g * 2)
  }
  if (target === 'right') {
    const w = RAIL + g + store.state.docks.right.size
    return px(R - g - w, T + g, w, B - T - g * 2)
  }
  const h = store.state.docks.bottom.size
  return px(L + g, B - g - h, R - L - g * 2, h)
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
/* over everything, the dragged panel included: mid-drag the pointer must never reach another
   panel (a video, an iframe or a handler that stops propagation there ends the drag) */
.shield {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  background: transparent;
}
.snapprev {
  position: fixed;
  pointer-events: none;
  border-radius: var(--zen-radius-surface, var(--zen-radius, 10px));
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
  box-sizing: border-box;
  border-radius: var(--zen-radius-surface, var(--zen-radius, 10px));
  background: color-mix(in srgb, var(--zen-accent, #3b82f6) 14%, transparent);
  border: 2px solid var(--zen-accent, #3b82f6);
  transition:
    left 0.09s,
    top 0.09s,
    width 0.09s,
    height 0.09s;
}
</style>
