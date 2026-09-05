<template>
  <!-- One tab rail per docked side; click toggles/switches, drag undocks. -->
  <template v-for="zone in zones" :key="zone.side">
    <div class="rail" :class="'side-' + zone.side" :style="rectStyle(zone.rail)">
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
      @pointerdown.stop="startResize($event, zone.side)"
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
import { computeDockLayout, RAIL, type ZoneLayout } from '../tiling'
import { dockDropFor } from '../dockDrop'
import { snapZoneFor } from '../panelStore'
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

const zones = computed<ZoneLayout[]>(() => {
  void vpTick.value
  const layout = computeDockLayout(store)
  return (['left', 'right', 'bottom'] as const).map((s) => layout[s]).filter((z) => z.rail)
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
      cursor: 'ew-resize',
    }
  if (zone.side === 'right')
    return {
      left: b.x - 7 + 'px',
      top: b.y + 'px',
      width: '12px',
      height: b.h + 'px',
      cursor: 'ew-resize',
    }
  return {
    left: b.x + 'px',
    top: b.y - 7 + 'px',
    width: b.w + 'px',
    height: '12px',
    cursor: 'ns-resize',
  }
}

// --- tab click vs drag-out ---
function onTabClick(zone: ZoneLayout, m: Panel) {
  if (m.id === zone.activeId && !zone.collapsed) ops.toggleDockCollapsed(zone.side)
  else ops.setDockActive(zone.side, m.id)
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
  if (e.button !== 0) return
  e.preventDefault()
  const sx = e.clientX
  const sy = e.clientY
  let dragging = false
  let off = { x: 0, y: 0 }
  const onMove = (mv: PointerEvent) => {
    if (!dragging) {
      if (Math.hypot(mv.clientX - sx, mv.clientY - sy) < 14) return
      // drag-out: undock to a floating panel under the cursor
      dragging = true
      ops.setDock(m.id, null)
      const p = ops.get(m.id)
      if (!p) return
      off = { x: Math.min(p.w / 2, mv.clientX), y: 14 }
      beginInteract('grabbing')
    }
    ops.setRect(m.id, { x: mv.clientX - off.x, y: mv.clientY - off.y })
    const drop = dockDropFor(mv.clientX, mv.clientY)
    store.state.dockDrop = drop
    store.state.snap = drop ? null : snapZoneFor(mv.clientX, mv.clientY)
  }
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    if (!dragging) {
      onTabClick(zone, m)
      return
    }
    if (store.state.dockDrop) ops.setDock(m.id, store.state.dockDrop)
    else if (store.state.snap) ops.applySnap(m.id, store.state.snap)
    store.state.dockDrop = null
    store.state.snap = null
    ops.setRect(m.id, {}, true)
    endInteract()
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

// --- zone resize ---
function startResize(e: PointerEvent, side: ZoneLayout['side']) {
  e.preventDefault()
  // capture so the drag survives crossing the canvas/iframes
  const grip = e.currentTarget as HTMLElement
  grip.setPointerCapture?.(e.pointerId)
  beginInteract(side === 'bottom' ? 'ns-resize' : 'ew-resize')
  const onMove = (m: PointerEvent) => {
    if (side === 'left') ops.setDockSize(side, m.clientX - RAIL)
    else if (side === 'right') ops.setDockSize(side, window.innerWidth - RAIL - m.clientX)
    else ops.setDockSize(side, window.innerHeight - RAIL - m.clientY)
  }
  const onUp = () => {
    endInteract()
    grip.releasePointerCapture?.(e.pointerId)
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
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
  background: color-mix(in srgb, var(--zen-surface, #202026) 92%, transparent);
  border: 1px solid var(--zen-border, #3a3a44);
  font-family: var(--p-font-family, system-ui, sans-serif);
}
.rail.side-left {
  border-width: 0 1px 0 0;
}
.rail.side-right {
  border-width: 0 0 0 1px;
}
.rail.side-bottom {
  border-width: 1px 0 0 0;
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
.tabs::-webkit-scrollbar {
  width: 0;
  height: 0;
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
/* 1px line centered in the 7px grip, on the canvas-facing edge */
.dockresize::before {
  content: '';
  position: absolute;
  background: var(--zen-border, #3a3a44);
  transition: background 0.12s ease;
}
.dockresize.rs-left::before,
.dockresize.rs-right::before {
  top: 0;
  bottom: 0;
  left: 50%;
  width: 1px;
  transform: translateX(-50%);
}
.dockresize.rs-bottom::before {
  left: 0;
  right: 0;
  top: 50%;
  height: 1px;
  transform: translateY(-50%);
}
.dockresize:hover::before {
  background: var(--zen-accent, #3b82f6);
}
.dockresize:hover {
  background: color-mix(in srgb, var(--zen-accent, #3b82f6) 40%, transparent);
}

.tabmenu {
  position: fixed;
  z-index: 100001;
  min-width: 150px;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  background: var(--zen-surface, #202026);
  border: 1px solid var(--zen-border, #3a3a44);
  border-radius: var(--zen-radius, 8px);
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
