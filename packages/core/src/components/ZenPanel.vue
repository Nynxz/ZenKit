<template>
  <div
    ref="rootRef"
    class="zp zenkit-panel"
    :class="{
      folded: isFloatFold,
      minimized,
      docked,
      bare,
      'pos-bottom': panel.headerPos === 'bottom',
    }"
    :style="zpStyle"
    :data-zen-status="panel.status"
    :data-zen-docked="docked"
    :data-zen-frame="panel.frame"
    :data-zen-active="isActive"
    :data-zen-interacting="isActive && store.state.interacting"
    @pointerdown="onPointerDown"
  >
    <!-- .body (below) is shared across dock<->float so content isn't re-mounted -->
    <template v-if="!docked && !bare">
      <!-- hidden-header grab strip: drag to move; right-click restores the header -->
      <div
        v-if="panel.headerHidden"
        class="hoverzone"
        title="drag to move · right-click to restore header"
        @pointerdown="startDrag"
        @contextmenu.prevent.stop="ops.setHeaderHidden(panel.id, false)"
      />

      <div
        class="bar zenkit-panel-header"
        :class="{ peek: panel.headerHidden }"
        @pointerdown="startDrag"
        @contextmenu.prevent.stop="openMenu($event)"
      >
        <ZenIcon class="tcon zenkit-panel-icon" :icon="panel.icon" />
        <span class="title zenkit-panel-title">{{ panel.title }}</span>
        <span class="grow" />
        <button
          class="b zenkit-panel-button"
          title="panel menu"
          @pointerdown.stop
          @click="openMenu($event)"
        >
          <i class="mdi mdi-dots-horizontal"></i>
        </button>
        <button
          class="b zenkit-panel-button"
          :title="folded ? 'expand' : 'collapse'"
          @pointerdown.stop
          @click="ops.toggleFold(panel.id)"
        >
          <i class="mdi" :class="folded ? 'mdi-chevron-down' : 'mdi-chevron-up'"></i>
        </button>
        <button
          class="b zenkit-panel-button"
          title="minimize"
          @pointerdown.stop
          @click="ops.minimize(panel.id)"
        >
          <i class="mdi mdi-minus"></i>
        </button>
        <button
          v-if="!docked"
          class="b zenkit-panel-button"
          :title="panel.maximized ? 'restore' : 'maximize'"
          @pointerdown.stop
          @click="ops.toggleMaximize(panel.id)"
        >
          <i
            class="mdi"
            :class="panel.maximized ? 'mdi-window-restore' : 'mdi-window-maximize'"
          ></i>
        </button>
        <button
          class="b close zenkit-panel-button"
          title="close"
          @pointerdown.stop
          @click="ops.close(panel.id)"
        >
          <i class="mdi mdi-close"></i>
        </button>
      </div>
    </template>

    <div v-show="bodyShown" ref="bodyRef" class="body zenkit-panel-body" />

    <template v-if="!docked && !folded && !bare">
      <div
        v-for="h in HANDLES"
        :key="h"
        class="rh"
        :class="h"
        @pointerdown.stop="startResize($event, h)"
      />
    </template>

    <Teleport to="body">
      <div
        v-if="menuOpen && !docked"
        ref="menuEl"
        class="menu"
        :style="menuStyle"
        @pointerdown.stop
      >
        <button @click="act(() => ops.setHeaderHidden(panel.id, !panel.headerHidden))">
          <i
            class="mdi"
            :class="panel.headerHidden ? 'mdi-arrow-expand-down' : 'mdi-arrow-collapse-up'"
          />
          {{ panel.headerHidden ? 'Show header' : 'Hide header' }}
        </button>
        <button
          @click="
            act(() => ops.setHeaderPos(panel.id, panel.headerPos === 'top' ? 'bottom' : 'top'))
          "
        >
          <i class="mdi mdi-format-vertical-align-bottom" />
          Header {{ panel.headerPos === 'top' ? 'to bottom' : 'to top' }}
        </button>
        <div class="sep" />
        <div class="submenu-item" @pointerenter="openSub" @pointerleave="scheduleCloseSub">
          <button
            class="submenu-trigger"
            :class="{ on: subOpen }"
            @click="subOpen ? closeSub() : openSub($event)"
          >
            <i class="mdi mdi-dock-window" />
            Dock
            <i class="mdi mdi-chevron-right caret" />
          </button>
          <div class="submenu" :class="{ open: subOpen, left: subLeft }">
            <button @click="act(() => ops.setDock(panel.id, 'left'))">
              <i class="mdi mdi-dock-left" />
              Left
            </button>
            <button @click="act(() => ops.setDock(panel.id, 'right'))">
              <i class="mdi mdi-dock-right" />
              Right
            </button>
            <button @click="act(() => ops.setDock(panel.id, 'bottom'))">
              <i class="mdi mdi-dock-bottom" />
              Bottom
            </button>
            <template v-if="store.state.sidebarAvailable">
              <div class="sep" />
              <button @click="act(() => ops.pinSidebar(panel.id))">
                <i class="mdi mdi-page-layout-sidebar-left" />
                ComfyUI sidebar
              </button>
            </template>
          </div>
        </div>
        <button
          v-if="canDetach"
          @click="act(() => detachPanel(panel.instanceOf ?? panel.id, panel.title))"
        >
          <i class="mdi mdi-open-in-new" />
          Open in separate window
        </button>
        <button @click="act(() => ops.resetRect(panel.id))">
          <i class="mdi mdi-backup-restore" />
          Reset size
        </button>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import { ZenIcon } from '@nynxz/zenkit-ui'
import { STORE_KEY, snapZoneFor, type Panel, type PanelStore } from '../panelStore'
import type { Rect } from '../types'
import { dockDropFor } from '../dockDrop'
import { detachPanel } from '../detach'

const props = defineProps<{ panel: Panel }>()
const store = inject(STORE_KEY) as PanelStore
const ops = store._ops
const HANDLES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const
const bodyRef = ref<HTMLElement | null>(null)
const rootRef = ref<HTMLElement | null>(null)
let contentRO: ResizeObserver | null = null
const DOCK_Z = 6 // docked panels sit on a fixed layer beneath floating panels (z 21+)

const folded = computed(() => props.panel.status === 'folded')
const minimized = computed(() => props.panel.status === 'minimized')
const docked = computed(() => props.panel.dockSide != null)
const bare = computed(() => props.panel.frame === 'none') // chromeless / transparent panel
const isFloatFold = computed(() => folded.value && !docked.value)
// detach a floating panel into its own OS window (desktop native window / browser popup)
const canDetach = computed(() => !docked.value && !props.panel.inSidebar)
// A docked panel only shows when it's the active tab of an expanded zone.
const dockVisible = computed(() => {
  const side = props.panel.dockSide
  if (!side) return false
  const z = store.state.docks[side]
  return z.active === props.panel.id && !z.collapsed
})
const bodyShown = computed(() => (docked.value ? dockVisible.value : !folded.value))

// The frontmost open window (highest z), exposed as `data-zen-active` for theme CSS.
// Mirrors ZenTaskbar's `focusedId` so the taskbar's active highlight and a theme's
// active-panel styling never disagree: docked / sidebar / bare / `zenkit:` panels are
// out of the window z-race, and nothing is active while all panels are hidden.
const isWindow = (p: Panel) =>
  p.dockSide == null &&
  !p.inSidebar &&
  p.frame !== 'none' &&
  p.status === 'open' &&
  !p.id.startsWith('zenkit:')
const isActive = computed(() => {
  if (store.state.panelsHidden || !isWindow(props.panel)) return false
  let top = props.panel
  for (const p of store.state.list) if (isWindow(p) && p.z > top.z) top = p
  return top.id === props.panel.id
})

const HEADER_PX = 33
const zpStyle = computed(() => {
  const p = props.panel
  if (docked.value) {
    // Fill the reserved dock rect exactly (the grid reflow pushes the canvas for us).
    return {
      left: p.x + 'px',
      top: p.y + 'px',
      width: Math.max(0, p.w) + 'px',
      height: Math.max(0, p.h) + 'px',
      zIndex: DOCK_Z,
      display: minimized.value || !dockVisible.value ? 'none' : 'flex',
    }
  }
  if (bare.value) {
    // ambient overlay: position only — size to the content (the character), so there's no
    // fixed/invisible rect to fight with. No fold/maximize geometry.
    return {
      left: p.x + 'px',
      top: p.y + 'px',
      width: 'auto',
      height: 'auto',
      zIndex: p.z,
      display: minimized.value || store.state.panelsHidden ? 'none' : 'flex',
    }
  }
  const foldH = p.headerHidden ? 12 : HEADER_PX
  // fold toward a bottom header instead of jumping it to the top
  const top = isFloatFold.value && p.headerPos === 'bottom' ? p.y + p.h - foldH : p.y
  return {
    left: p.x + 'px',
    top: top + 'px',
    width: p.w + 'px',
    height: isFloatFold.value ? foldH + 'px' : p.h + 'px',
    zIndex: p.z,
    display: minimized.value || store.state.panelsHidden ? 'none' : 'flex',
  }
})

function onPointerDown(e: PointerEvent) {
  if (!docked.value) ops.front(props.panel.id) // docked panels stay out of the z-race
  // bare panels have no header — drag them by any element the consumer marks `.zen-grip`
  if (bare.value && (e.target as Element | null)?.closest?.('.zen-grip')) startDrag(e)
}

onMounted(() => {
  if (bodyRef.value) {
    const ret = props.panel.render(bodyRef.value, props.panel.ctx)
    // eslint-disable-next-line vue/no-mutating-props -- `panel` is a host-owned registration object, not Vue state — stashing its cleanup on it is the contract.
    if (typeof ret === 'function') props.panel.cleanup = ret
  }
  // Bare panels size to their content; keep their anchored corner fixed as that
  // content grows/shrinks (e.g. the mascot scaling) by reporting the measured size.
  if (bare.value && rootRef.value && typeof ResizeObserver !== 'undefined') {
    contentRO = new ResizeObserver((entries) => {
      const box = entries[0]?.borderBoxSize?.[0]
      const w = box ? box.inlineSize : (rootRef.value?.offsetWidth ?? 0)
      const h = box ? box.blockSize : (rootRef.value?.offsetHeight ?? 0)
      if (w > 0 && h > 0) ops.setContentSize(props.panel.id, Math.round(w), Math.round(h))
    })
    contentRO.observe(rootRef.value)
  }
})
onBeforeUnmount(() => {
  contentRO?.disconnect()
  contentRO = null
  closeMenu()
  if (props.panel.cleanup) {
    const c = props.panel.cleanup
    // eslint-disable-next-line vue/no-mutating-props -- `panel` is a host-owned registration object, not Vue state — stashing its cleanup on it is the contract.
    props.panel.cleanup = null
    try {
      c()
    } catch (e) {
      console.error('[ZenKit] panel cleanup threw', e)
    }
  }
})

// --- header settings menu ---
const menuOpen = ref(false)
const menuEl = ref<HTMLElement | null>(null)
const menuStyle = ref<Record<string, string>>({})
function onDocPointer(e: PointerEvent) {
  if (menuEl.value && !menuEl.value.contains(e.target as Node)) closeMenu()
}
const MENU_W = 172
function openMenu(e?: MouseEvent) {
  ops.front(props.panel.id)
  // anchor the (body-teleported) menu to the trigger so it escapes the panel clip
  const r = (e?.currentTarget as HTMLElement | undefined)?.getBoundingClientRect?.()
  if (r) {
    const left = Math.max(8, Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 8))
    menuStyle.value =
      props.panel.headerPos === 'bottom'
        ? { left: left + 'px', bottom: window.innerHeight - r.top + 4 + 'px' }
        : { left: left + 'px', top: r.bottom + 4 + 'px' }
  }
  menuOpen.value = true
  setTimeout(() => window.addEventListener('pointerdown', onDocPointer, true), 0)
}
function closeMenu() {
  if (!menuOpen.value) return
  menuOpen.value = false
  closeSub()
  window.removeEventListener('pointerdown', onDocPointer, true)
}

// nested Dock submenu — JS hover-intent: a close-delay bridges the move from the trigger to
// the submenu so a quick/diagonal path doesn't snap it shut (the failing of a pure CSS :hover
// submenu). subLeft flips it to the left when it would overflow the viewport's right edge.
const subOpen = ref(false)
const subLeft = ref(false)
let subTimer: ReturnType<typeof setTimeout> | undefined
function openSub(e?: Event) {
  clearTimeout(subTimer)
  const r = (e?.currentTarget as HTMLElement | undefined)?.getBoundingClientRect?.()
  subLeft.value = !!r && r.right + 162 > window.innerWidth
  subOpen.value = true
}
function scheduleCloseSub() {
  clearTimeout(subTimer)
  subTimer = setTimeout(() => {
    subOpen.value = false
  }, 220)
}
function closeSub() {
  clearTimeout(subTimer)
  subOpen.value = false
}
function act(fn: () => void) {
  fn()
  closeMenu()
}
const CURSORS: Record<string, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  se: 'nwse-resize',
  nw: 'nwse-resize',
}
function beginInteract(cursor: string) {
  document.body.style.userSelect = 'none'
  ;(document.body.style as CSSStyleDeclaration & { webkitUserSelect?: string }).webkitUserSelect =
    'none'
  document.body.style.cursor = cursor
  ops.setInteract(true, cursor)
}
function endInteract() {
  document.body.style.userSelect = ''
  ;(document.body.style as CSSStyleDeclaration & { webkitUserSelect?: string }).webkitUserSelect =
    ''
  document.body.style.cursor = ''
  ops.setInteract(false)
}

function startDrag(e: PointerEvent) {
  e.preventDefault()
  const p = props.panel
  ops.front(p.id)
  beginInteract('grabbing')
  if (p.restoreRect) {
    const rw = p.restoreRect.w
    const rh = p.restoreRect.h
    ops.clearRestore(p.id)
    ops.setRect(p.id, { x: e.clientX - rw / 2, y: e.clientY - 14, w: rw, h: rh })
  }
  // dragging a maximized panel restores its pre-max size under the cursor (OS behavior)
  if (p.maximized) {
    const rw = p.preMax?.w ?? Math.round(window.innerWidth * 0.5)
    const rh = p.preMax?.h ?? Math.round(window.innerHeight * 0.6)
    ops.toggleMaximize(p.id) // un-maximize (restores pre-max geom)
    ops.setRect(p.id, { x: e.clientX - rw / 2, y: e.clientY - 14, w: rw, h: rh })
  }
  const ox = e.clientX - p.x
  const oy = e.clientY - p.y
  const onMove = (m: PointerEvent) => {
    ops.setRect(p.id, { x: m.clientX - ox, y: m.clientY - oy })
    if (bare.value) return // ambient overlays never dock or snap to edges
    // edge → dock-drop preview, else snap preview
    const drop = dockDropFor(m.clientX, m.clientY)
    store.state.dockDrop = drop
    store.state.snap = drop ? null : snapZoneFor(m.clientX, m.clientY)
  }
  const onUp = () => {
    // Drag to an edge → ZenKit dock zone (overlays the canvas). The native "Comfy
    // sidebar" is a separate, untouched feature (right-click → Pin to sidebar).
    if (store.state.dockDrop) ops.setDock(p.id, store.state.dockDrop)
    else if (store.state.snap) ops.applySnap(p.id, store.state.snap)
    store.state.snap = null
    store.state.dockDrop = null
    ops.setRect(p.id, {}, true)
    endInteract()
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

function startResize(e: PointerEvent, h: (typeof HANDLES)[number]) {
  e.preventDefault()
  const p = props.panel
  ops.front(p.id)
  ops.clearRestore(p.id)
  beginInteract(CURSORS[h] || 'default')
  const start = { x: p.x, y: p.y, w: p.w, h: p.h }
  const sx = e.clientX
  const sy = e.clientY
  const onMove = (m: PointerEvent) => {
    const dx = m.clientX - sx
    const dy = m.clientY - sy
    const r: Rect = { ...start }
    if (h.includes('e')) r.w = start.w + dx
    if (h.includes('s')) r.h = start.h + dy
    if (h.includes('w')) {
      r.w = start.w - dx
      r.x = start.x + dx
    }
    if (h.includes('n')) {
      r.h = start.h - dy
      r.y = start.y + dy
    }
    if (r.w < p.minWidth && h.includes('w')) r.x = start.x + (start.w - p.minWidth)
    if (r.h < p.minHeight && h.includes('n')) r.y = start.y + (start.h - p.minHeight)
    ops.setRect(p.id, r)
  }
  const onUp = () => {
    ops.setRect(p.id, {}, true)
    endInteract()
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}
</script>

<style scoped>
.zp {
  position: fixed;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--zen-glass, color-mix(in srgb, var(--zen-bg, #1a1a1f) 86%, transparent));
  border: 1px solid color-mix(in srgb, var(--zen-border, #3a3a44) 86%, transparent);
  border-radius: var(--zen-radius, 10px);
  /* layered depth + a top hairline "glass lip" so the panel reads as lifted, not flat */
  box-shadow:
    0 18px 48px -16px rgba(0, 0, 0, 0.62),
    0 4px 14px -8px rgba(0, 0, 0, 0.45),
    inset 0 1px 0 rgba(255, 255, 255, 0.07);
  backdrop-filter: blur(14px) saturate(1.08);
  font-family: var(--p-font-family, -apple-system, system-ui, sans-serif);
  color: var(--zen-text, #e5e5ea);
}
.zp.pos-bottom {
  flex-direction: column-reverse;
}
/* bare / chromeless: no frame, transparent, and click-through — pointer-events is inherited,
   so only the consumer's content that opts back in (.zen-grip, or its own pointer-events)
   is interactive; the empty areas pass clicks to the canvas behind. */
.zp.bare {
  background: none;
  border: none;
  border-radius: 0;
  box-shadow: none;
  backdrop-filter: none;
  overflow: visible;
  pointer-events: none;
}
.zp.bare .body {
  overflow: visible;
  flex: 0 0 auto;
}
/* docked panel = a solid panel filling its reserved grid cell (canvas reflows around it) */
.zp.docked {
  background: var(--zen-bg, #1a1a1f);
  border-radius: 0;
}
.bar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 6px 0 11px;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--zen-surface, #202026) 92%, transparent),
    color-mix(in srgb, var(--zen-surface, #202026) 62%, transparent)
  );
  border-bottom: 1px solid color-mix(in srgb, var(--zen-border, #3a3a44) 85%, transparent);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
  cursor: grab;
  user-select: none;
  touch-action: none;
}
.zp.pos-bottom .bar {
  border-bottom: none;
  border-top: 1px solid color-mix(in srgb, var(--zen-border, #3a3a44) 85%, transparent);
}
.bar:active {
  cursor: grabbing;
}
.tcon {
  font-size: 14px;
  color: var(--zen-accent, #3b82f6);
}
.title {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.003em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.grow {
  flex: 1;
}
.b {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: var(--zen-radius, 6px);
  background: none;
  color: var(--zen-muted, #9aa0aa);
  cursor: pointer;
}
.b:hover {
  background: color-mix(in srgb, var(--zen-text, #fff) 12%, transparent);
  color: var(--zen-text, #fff);
}
.b.close:hover {
  background: #b91c1c;
  color: #fff;
}
.b .mdi {
  font-size: 16px;
}

/* hidden header: parked off-screen until right-click restores it (no hover peek) */
.bar.peek {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  z-index: 4;
  transform: translateY(-100%);
  transition: transform 0.14s ease;
  border-radius: var(--zen-radius, 10px) var(--zen-radius, 10px) 0 0;
}
.zp.pos-bottom .bar.peek {
  top: auto;
  bottom: 0;
  transform: translateY(100%);
  border-radius: 0 0 var(--zen-radius, 10px) var(--zen-radius, 10px);
}
/* hidden-header grab strip: drag to move the panel */
.hoverzone {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 8px;
  z-index: 3;
  cursor: grab;
  touch-action: none;
}
.hoverzone:active {
  cursor: grabbing;
}
.zp.pos-bottom .hoverzone {
  top: auto;
  bottom: 0;
}
.hoverzone::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 34px;
  height: 3px;
  border-radius: var(--zen-radius, 2px);
  background: var(--zen-muted, #9aa0aa);
  opacity: 0;
  transition: opacity 0.15s ease;
}
.hoverzone:hover::after {
  opacity: 0.6;
}

.body {
  flex: 1 1 0;
  min-height: 0;
  overflow: hidden;
}

.rh {
  position: absolute;
  z-index: 2;
  touch-action: none;
  user-select: none;
}
.rh.n {
  top: -3px;
  left: 8px;
  right: 8px;
  height: 7px;
  cursor: ns-resize;
}
.rh.s {
  bottom: -3px;
  left: 8px;
  right: 8px;
  height: 7px;
  cursor: ns-resize;
}
.rh.e {
  right: -3px;
  top: 8px;
  bottom: 8px;
  width: 7px;
  cursor: ew-resize;
}
.rh.w {
  left: -3px;
  top: 8px;
  bottom: 8px;
  width: 7px;
  cursor: ew-resize;
}
.rh.ne {
  top: -4px;
  right: -4px;
  width: 12px;
  height: 12px;
  cursor: nesw-resize;
}
.rh.nw {
  top: -4px;
  left: -4px;
  width: 12px;
  height: 12px;
  cursor: nwse-resize;
}
.rh.se {
  bottom: -4px;
  right: -4px;
  width: 12px;
  height: 12px;
  cursor: nwse-resize;
}
.rh.sw {
  bottom: -4px;
  left: -4px;
  width: 12px;
  height: 12px;
  cursor: nesw-resize;
}

/* settings dropdown (teleported to body, fixed-positioned, so the panel clip can't cut it off) */
.menu {
  position: fixed;
  z-index: 100000;
  min-width: 168px;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  background: var(--zen-surface, #202026);
  border: 1px solid var(--zen-border, #3a3a44);
  border-radius: var(--zen-radius, 8px);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
}
.menu button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  text-align: left;
  cursor: pointer;
  background: none;
  border: none;
  color: var(--zen-text, #e5e5ea);
  border-radius: max(0px, calc(var(--zen-radius, 8px) - 3px));
  padding: 6px 8px;
  font-size: 12px;
  font-family: inherit;
}
.menu button:hover {
  background: color-mix(in srgb, var(--zen-text, #fff) 10%, transparent);
}
.menu button .mdi {
  font-size: 15px;
  color: var(--zen-muted, #9aa0aa);
}
.menu .sep {
  height: 1px;
  background: var(--zen-border, #3a3a44);
  margin: 3px 2px;
}
.menu .submenu-item {
  position: relative;
}
.menu .submenu-trigger {
  width: 100%;
}
.menu .caret {
  margin-left: auto;
}
.menu .submenu {
  display: none;
  position: absolute;
  left: 100%;
  top: -5px;
  min-width: 150px;
  padding: 4px;
  background: var(--zen-surface, #202026);
  border: 1px solid var(--zen-border, #3a3a44);
  border-radius: var(--zen-radius, 8px);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
}
.menu .submenu.left {
  left: auto;
  right: 100%;
}
.menu .submenu.open {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.menu .submenu-trigger.on {
  background: color-mix(in srgb, var(--zen-text, #fff) 10%, transparent);
}
</style>

<!-- global (un-scoped) so it reaches the consumer's content mounted inside a bare panel -->
<style>
.zen-grip {
  pointer-events: auto;
  cursor: grab;
}
.zen-grip:active {
  cursor: grabbing;
}
</style>
