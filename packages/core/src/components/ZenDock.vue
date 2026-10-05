<template>
  <!-- One tab rail per docked side; click toggles/switches, drag undocks. -->
  <template v-for="zone in zones" :key="zone.side">
    <div v-if="zone.rail" class="rail" :class="'side-' + zone.side" :style="rectStyle(zone.rail)">
      <div class="tabs" :class="zone.side === 'bottom' ? 'horiz' : 'vert'">
        <button
          v-for="m in zone.members"
          :key="m.id"
          class="tab"
          :class="{ active: m.id === zone.activeId && !zone.collapsed }"
          :title="m.title"
          @pointerdown="onTabDown($event, zone, m)"
          @contextmenu.prevent.stop="openTabMenu($event, zone.side, m.id)"
        >
          <ZenIcon class="ico" :icon="m.icon" />
          <span class="label">{{ m.title }}</span>
        </button>
      </div>
    </div>

    <!-- inner-edge resize grip (expanded zones only) -->
    <div
      v-if="zone.body"
      class="dockresize"
      :class="'rs-' + zone.side"
      :style="resizeStyle(zone)"
      @pointerenter="store.state.dockEdgeLit = zone.side"
      @pointerleave="!store.state.interacting && (store.state.dockEdgeLit = null)"
      @pointerdown.stop="startResize($event, zone)"
    />
  </template>

  <!-- tab context menu -->
  <div
    v-if="tabMenu"
    ref="menuEl"
    class="tabmenu"
    :style="{ left: tabMenu.x + 'px', top: tabMenu.y + 'px' }"
    @pointerdown.stop
  >
    <button @click="menuAct(() => ops.setDock(tabMenu!.id, null))">
      <i class="mdi mdi-window-restore" />
      Undock (float)
    </button>
    <button v-if="store.state.sidebarAvailable" @click="menuAct(() => ops.pinSidebar(tabMenu!.id))">
      <i class="mdi mdi-dock-left" />
      Pin to sidebar
    </button>
    <button @click="menuAct(() => detachTab(tabMenu!.id))">
      <i class="mdi mdi-open-in-new" />
      Open in separate window
    </button>
    <button @click="menuAct(() => ops.minimize(tabMenu!.id))">
      <i class="mdi mdi-minus" />
      Minimize
    </button>
    <button class="danger" @click="menuAct(() => ops.close(tabMenu!.id))">
      <i class="mdi mdi-close" />
      Close
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import { ZenIcon } from '@nynxz/zenkit-ui'
import { STORE_KEY, type Panel, type PanelStore } from '../panelStore'
import { computeDockLayout, dockLayout, dockLayoutVersion, type ZoneLayout } from '../tiling'
import { startDockTabDrag } from '../dockDrag'
import { detachPanel } from '../detach'
import type { Rect } from '../types'

const store = inject(STORE_KEY) as PanelStore

// Pop a docked panel out into its own window — re-mounts the registration standalone,
// so dock state is irrelevant (same path the floating panel menu uses).
function detachTab(id: string) {
  const p = store.state.list.find((x) => x.id === id)
  if (p) detachPanel(p.instanceOf ?? p.id, p.title)
}
const ops = store._ops

// computeDockLayout reads window size (non-reactive) — bump on resize.
const vpTick = ref(0)
const onResize = () => vpTick.value++
onMounted(() => window.addEventListener('resize', onResize))
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  if (tabMenu.value) closeTabMenu()
})

// Draw what the last re-layout settled on; measuring here again would force another layout.
const zones = computed<ZoneLayout[]>(() => {
  void vpTick.value
  void dockLayoutVersion.value
  const layout = dockLayout.value ?? computeDockLayout(store)
  return (['left', 'right', 'bottom'] as const)
    .map((s) => layout[s])
    .filter((z) => z.rail || z.body)
})

const rectStyle = (r: Rect | null) =>
  r ? { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' } : {}

// grip on the zone's inner boundary; 12px hit zone biased outward (the extra
// reach lands on empty canvas, not the panel's interactive content)
function resizeStyle(zone: ZoneLayout): Record<string, string> {
  const b = zone.body!
  if (zone.side === 'left')
    return {
      left: b.x + b.w - 5 + 'px',
      top: b.y + 'px',
      width: '12px',
      height: b.h + 'px',
      cursor: 'col-resize',
    }
  if (zone.side === 'right')
    return {
      left: b.x - 7 + 'px',
      top: b.y + 'px',
      width: '12px',
      height: b.h + 'px',
      cursor: 'col-resize',
    }
  return {
    left: b.x + 'px',
    top: b.y - 7 + 'px',
    width: b.w + 'px',
    height: '12px',
    cursor: 'row-resize',
  }
}

// --- tab click vs drag-out ---
function onTabClick(zone: ZoneLayout, m: Panel) {
  ops.toggleDockTab(zone.side, m.id)
}

function beginInteract(cursor: string) {
  document.body.style.userSelect = 'none'
  document.body.style.cursor = cursor
  ops.setInteract(true, cursor)
}
function endInteract() {
  document.body.style.userSelect = ''
  document.body.style.cursor = ''
  ops.setInteract(false)
}

function onTabDown(e: PointerEvent, zone: ZoneLayout, m: Panel) {
  startDockTabDrag(e, store, m.id, () => onTabClick(zone, m))
}

// --- zone resize ---
function startResize(e: PointerEvent, zone: ZoneLayout) {
  e.preventDefault()
  const { side } = zone
  const body = zone.body!
  // capture so the drag survives crossing the canvas/iframes
  const grip = e.currentTarget as HTMLElement
  grip.setPointerCapture?.(e.pointerId)
  beginInteract(side === 'bottom' ? 'row-resize' : 'col-resize')
  const onMove = (m: PointerEvent) => {
    if (side === 'left') ops.setDockSize(side, m.clientX - body.x, false)
    else if (side === 'right') ops.setDockSize(side, body.x + body.w - m.clientX, false)
    else ops.setDockSize(side, body.y + body.h - m.clientY, false)
  }
  const onUp = (u: PointerEvent) => {
    endInteract()
    ops.setDockSize(side, store.state.docks[side].size)
    if (document.elementFromPoint(u.clientX, u.clientY) !== grip) store.state.dockEdgeLit = null
    grip.releasePointerCapture?.(e.pointerId)
    window.removeEventListener('pointermove', onMove, true)
    window.removeEventListener('pointerup', onUp, true)
  }
  window.addEventListener('pointermove', onMove, true)
  window.addEventListener('pointerup', onUp, true)
}

// --- tab context menu ---
const tabMenu = ref<{ side: ZoneLayout['side']; id: string; x: number; y: number } | null>(null)
const menuEl = ref<HTMLElement | null>(null)
function onDocPointer(ev: PointerEvent) {
  if (menuEl.value && !menuEl.value.contains(ev.target as Node)) closeTabMenu()
}
function openTabMenu(e: MouseEvent, side: ZoneLayout['side'], id: string) {
  tabMenu.value = { side, id, x: e.clientX, y: e.clientY }
  setTimeout(() => window.addEventListener('pointerdown', onDocPointer, true), 0)
}
function closeTabMenu() {
  tabMenu.value = null
  window.removeEventListener('pointerdown', onDocPointer, true)
}
function menuAct(fn: () => void) {
  fn()
  closeTabMenu()
}
</script>

<style scoped>
.rail {
  position: fixed;
  z-index: 7;
  pointer-events: auto;
  display: flex;
  overflow: hidden;
  box-sizing: border-box;
  background: var(--zen-chrome-bg, var(--zen-surface, #202026));
  border: 1px solid var(--zen-surface-border, var(--zen-border, #3a3a44));
  border-radius: var(--zen-radius-surface, var(--zen-radius, 10px));
  box-shadow: var(--interface-floating-panel-shadow, 0 6px 18px rgba(0, 0, 0, 0.28));
  font-family: var(--p-font-family, system-ui, sans-serif);
}

.tabs {
  display: flex;
  gap: 4px;
  padding: 6px;
  overflow: auto;
  flex: 1;
}
.tabs.vert {
  flex-direction: column;
  align-items: stretch;
}
.tabs.horiz {
  flex-direction: row;
  align-items: stretch;
}
/* hide scrollbars on the rail */
.tabs {
  scrollbar-width: none;
}

.tab {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  cursor: pointer;
  border: 1px solid transparent;
  border-radius: var(--zen-radius, 7px);
  padding: 8px 4px;
  background: none;
  color: var(--zen-muted, #9aa0aa);
  font-family: inherit;
  user-select: none;
  touch-action: none;
  white-space: nowrap;
  overflow: hidden;
}
.tab:hover {
  background: color-mix(in srgb, var(--zen-text, #fff) 9%, transparent);
  color: var(--zen-text, #e5e5ea);
}
.tab.active {
  color: var(--zen-accent, #3b82f6);
  background: color-mix(in srgb, var(--zen-accent, #3b82f6) 18%, transparent);
  border-color: color-mix(in srgb, var(--zen-accent, #3b82f6) 45%, transparent);
}
.tab .ico {
  font-size: 16px;
}
.tab .label {
  font-size: 11px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* sideways text + vertical stacking for the side rails */
.tabs.vert .tab {
  flex-direction: column;
  padding: 10px 5px;
}
.tabs.vert .tab .label {
  writing-mode: vertical-rl;
  text-orientation: mixed;
  max-height: 220px;
}
.tabs.horiz .tab {
  flex-direction: row;
  padding: 6px 12px;
}
.tabs.horiz .tab .label {
  max-width: 180px;
}

.dockresize {
  position: fixed;
  z-index: 8;
  touch-action: none;
  user-select: none;
  pointer-events: auto;
}
.tabmenu {
  position: fixed;
  z-index: 100001;
  min-width: 150px;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  background: var(--zen-chrome-bg, var(--zen-surface, #202026));
  border: 1px solid var(--zen-surface-border, var(--zen-border, #3a3a44));
  border-radius: var(--zen-radius-surface, var(--zen-radius, 8px));
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  pointer-events: auto;
  font-family: var(--p-font-family, system-ui, sans-serif);
}
.tabmenu button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  text-align: left;
  cursor: pointer;
  background: none;
  border: none;
  color: var(--zen-text, #e5e5ea);
  border-radius: var(--zen-radius, 5px);
  padding: 6px 8px;
  font-size: 12px;
  font-family: inherit;
}
.tabmenu button:hover {
  background: color-mix(in srgb, var(--zen-text, #fff) 10%, transparent);
}
.tabmenu button.danger:hover {
  background: #b91c1c;
  color: #fff;
}
.tabmenu button .mdi {
  font-size: 15px;
  color: var(--zen-muted, #9aa0aa);
}
</style>
