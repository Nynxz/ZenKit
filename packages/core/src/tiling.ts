// Dock layout. Docked panels reserve width/height in ComfyUI's grid side-cells
// (#comfyui-body-left/right/bottom) so the canvas reflows; our dock overlays the
// reserved strip. Each side is a tab group: a rail of tabs + the active tab's body.

import { watch } from 'vue'
import type { Panel, PanelStore } from './panelStore'
import { DOCK_SIDES, type DockSidePos } from './panelStore'
import type { Rect } from './types'

const DOCK = { minW: 220, maxW: 1100, minH: 160, maxH: 900 }
export const RAIL = 34 // always-visible tab rail thickness
export const TASKBAR_H = 32 // permanent taskbar — reserved out of the canvas
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

function bodyCell(side: DockSidePos): HTMLElement | null {
  return document.getElementById('comfyui-body-' + side) as HTMLElement | null
}

// Reserve px in a ComfyUI grid side-cell (0 clears it). The grid reflows the canvas
// naturally — ComfyUI handles the graph/minimap/controls; we just take the space.
function reserve(side: DockSidePos, px: number) {
  const el = bodyCell(side)
  if (!el) return
  if (px > 0) {
    if (side === 'bottom') {
      el.style.height = px + 'px'
      el.style.minHeight = px + 'px'
    } else {
      el.style.width = px + 'px'
      el.style.minWidth = px + 'px'
    }
    el.setAttribute('data-zen-dock', '1')
  } else if (el.getAttribute('data-zen-dock') === '1') {
    el.style.removeProperty('width')
    el.style.removeProperty('min-width')
    el.style.removeProperty('height')
    el.style.removeProperty('min-height')
    el.removeAttribute('data-zen-dock')
  }
}

function nudgeCanvas() {
  try {
    const anyWin = window as unknown as { app?: { canvas?: { resize?: () => void } } }
    anyWin.app?.canvas?.resize?.()
    window.dispatchEvent(new Event('resize'))
  } catch {
    /* best-effort */
  }
}

// Height of ComfyUI's top menu bar so our floating dock sits below it.
function topbarHeight(): number {
  const el = document.getElementById('comfyui-body-top')
  const h = el?.offsetHeight ?? 0
  return h > 0 && h < 200 ? h : 0
}

// Reserve the top-menu cell for a top-edge taskbar by inflating it past its NATURAL
// height (captured once, so re-runs don't compound). Stashes the natural height in
// the store so the taskbar can sit just below ComfyUI's menu. px=0 restores it.
function reserveTop(store: PanelStore, px: number) {
  const el = document.getElementById('comfyui-body-top')
  if (!el) return
  if (px > 0) {
    if (el.getAttribute('data-zen-tb') !== '1') {
      el.setAttribute('data-zen-tb-nat', String(el.offsetHeight))
      el.setAttribute('data-zen-tb', '1')
    }
    const nat = Number(el.getAttribute('data-zen-tb-nat')) || 0
    store.state.topbarH = nat
    el.style.height = nat + px + 'px'
    el.style.minHeight = nat + px + 'px'
  } else if (el.getAttribute('data-zen-tb') === '1') {
    el.style.removeProperty('height')
    el.style.removeProperty('min-height')
    el.removeAttribute('data-zen-tb')
    el.removeAttribute('data-zen-tb-nat')
  }
}

export interface ZoneLayout {
  side: DockSidePos
  members: Panel[]
  activeId: string | null
  collapsed: boolean
  rail: Rect | null // the tab strip (null when the side has no tabs)
  body: Rect | null // the active tab's content area (null when empty or collapsed)
  reserve: number // px reserved in the grid side-cell (rail + body)
}
export type DockLayout = Record<DockSidePos, ZoneLayout>

// Dock geometry: grid reserve + rail/body rects per side.
export function computeDockLayout(store: PanelStore): DockLayout {
  const W = window.innerWidth
  const H = window.innerHeight
  const top = topbarHeight() // already inflated by reserveTop when the taskbar is on top
  const bot = H - (store.state.taskbarPos === 'bottom' ? TASKBAR_H : 0)
  const zoneFor = (side: DockSidePos): ZoneLayout => {
    const members = store._ops.dockMembers(side)
    const z = store.state.docks[side]
    const activeId = members.some((p) => p.id === z.active) ? z.active : (members[0]?.id ?? null)
    if (!members.length)
      return {
        side,
        members,
        activeId: null,
        collapsed: z.collapsed,
        rail: null,
        body: null,
        reserve: 0,
      }
    const collapsed = z.collapsed
    if (side === 'bottom') {
      const size = clamp(z.size, DOCK.minH, Math.min(DOCK.maxH, Math.floor(H * 0.66)))
      const reserve = RAIL + (collapsed ? 0 : size)
      return {
        side,
        members,
        activeId,
        collapsed,
        rail: { x: 0, y: bot - RAIL, w: W, h: RAIL },
        body: collapsed ? null : { x: 0, y: bot - RAIL - size, w: W, h: size },
        reserve,
      }
    }
    const size = clamp(z.size, DOCK.minW, Math.min(DOCK.maxW, Math.floor(W * 0.66)))
    const reserve = RAIL + (collapsed ? 0 : size)
    if (side === 'left') {
      return {
        side,
        members,
        activeId,
        collapsed,
        rail: { x: 0, y: top, w: RAIL, h: bot - top },
        body: collapsed ? null : { x: RAIL, y: top, w: size, h: bot - top },
        reserve,
      }
    }
    // right
    return {
      side,
      members,
      activeId,
      collapsed,
      rail: { x: W - RAIL, y: top, w: RAIL, h: bot - top },
      body: collapsed ? null : { x: W - RAIL - size, y: top, w: size, h: bot - top },
      reserve,
    }
  }
  const left = zoneFor('left')
  const right = zoneFor('right')
  const bottom = zoneFor('bottom')
  // bottom zone spans only between the side docks; re-inset it horizontally
  if (bottom.rail) {
    const bx = left.reserve
    const w = Math.max(0, W - left.reserve - right.reserve)
    bottom.rail = { ...bottom.rail, x: bx, w }
    if (bottom.body) bottom.body = { ...bottom.body, x: bx, w }
  }
  return { left, right, bottom }
}

export function startTiling(store: PanelStore) {
  let pumping = false
  function recompute() {
    // nudgeCanvas dispatches a synthetic resize that re-enters recompute; guard the loop
    if (pumping) return
    pumping = true
    try {
      doRecompute()
    } finally {
      pumping = false
    }
  }
  function doRecompute() {
    const tbTop = store.state.taskbarPos === 'top'
    reserveTop(store, tbTop ? TASKBAR_H : 0) // before measuring, so topbarHeight() is current
    const layout = computeDockLayout(store)
    for (const side of DOCK_SIDES) {
      const zone = layout[side]
      // stack all members on the body rect; ZenPanel shows only the active tab
      const target = zone.body
      if (target) for (const p of zone.members) Object.assign(p, target)
      // Reserve the dock's space in the grid cell so the canvas reflows around it
      // (+ the bottom taskbar strip when it's at the bottom).
      reserve(side, zone.reserve + (side === 'bottom' && !tbTop ? TASKBAR_H : 0))
    }
    nudgeCanvas()
  }
  watch(
    () => {
      const docks = store.state.docks
      const d = DOCK_SIDES.map(
        (s) => `${s}:${docks[s].active}:${docks[s].collapsed}:${docks[s].size}`,
      ).join('|')
      const p = store.state.list
        .map((x) => `${x.id}:${x.dockSide}:${x.status}:${x.dockOrder}`)
        .join(',')
      return d + '#' + p + '#' + store.state.taskbarPos
    },
    recompute,
    { immediate: true },
  )
  window.addEventListener('resize', recompute)
}
