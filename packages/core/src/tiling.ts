// Dock layout. Docks float over the canvas as inset cards — a tab rail and the active tab's
// body, a gutter apart, like ComfyUI's floating sidebar and its separated panel. Nothing
// resizes the canvas: instead the row that holds ComfyUI's own chrome (sidebar, Run bar,
// minimap, canvas controls) is padded by each dock's footprint, so that chrome moves aside
// while the graph underneath stays put. Only the taskbar still reserves a grid cell, and it
// never changes size.

import { ref, watch } from 'vue'
import type { Panel, PanelStore } from './panelStore'
import { DOCK_SIDES, setFloatingBarInset, type DockSidePos } from './panelStore'
import type { Rect } from './types'

const DOCK = { minW: 220, maxW: 1100, minH: 160, maxH: 900 }
export const RAIL = 34 // always-visible tab rail thickness
export const TASKBAR_H = 32 // permanent taskbar — reserved out of the canvas
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

function bodyCell(side: DockSidePos): HTMLElement | null {
  return document.getElementById('comfyui-body-' + side) as HTMLElement | null
}

// Reserve px in a ComfyUI grid side-cell (0 clears it). Returns whether it changed, since a
// change resizes the canvas.
function reserve(side: DockSidePos, px: number): boolean {
  const el = bodyCell(side)
  if (!el) return false
  const prop = side === 'bottom' ? 'height' : 'width'
  const was = el.getAttribute('data-zen-dock') === '1' ? el.style[prop] : ''
  if (was === (px > 0 ? px + 'px' : '')) return false
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
  return true
}

// The row holding ComfyUI's chrome in the visible mode: the graph overlay's row around the
// sidebar and splitter, or app mode's workspace row.
function chromeRows(): HTMLElement[] {
  const graph = document.querySelector('.side-toolbar-container')?.parentElement?.parentElement
  const app = document.querySelector('[data-testid="linear-workspace-column"]')?.parentElement
  return [graph, app].filter((el): el is HTMLElement => !!el)
}
function visibleChromeRow(): HTMLElement | null {
  return chromeRows().find((el) => el.getBoundingClientRect().width > 0) ?? null
}

// The canvas gutter ComfyUI insets its own floating chrome by (a custom property, so it is
// resolved through a length property).
export function canvasGutter(): number {
  const probe = document.createElement('div')
  probe.style.cssText =
    'position:absolute;visibility:hidden;margin-left:var(--comfy-canvas-gutter, 8px)'
  document.body.append(probe)
  const px = parseFloat(getComputedStyle(probe).marginLeft)
  probe.remove()
  return Number.isFinite(px) ? px : 8
}

const PAD_ATTR = 'data-zen-dock-pad'
let lastPad: Record<DockSidePos, number> = { left: 0, right: 0, bottom: 0 }
// Chrome eases aside when a dock opens or closes, but tracks a resize drag exactly.
function padChrome(pad: Record<DockSidePos, number>, animate: boolean) {
  lastPad = pad
  for (const row of chromeRows()) padRow(row, pad, animate && row.hasAttribute(PAD_ATTR))
}
function padRow(row: HTMLElement, pad: Record<DockSidePos, number>, animate: boolean) {
  const any = pad.left || pad.right || pad.bottom
  if (!any && !row.hasAttribute(PAD_ATTR)) return
  row.setAttribute(PAD_ATTR, '')
  row.style.transition = animate ? 'padding 0.2s cubic-bezier(0.4, 0, 0.2, 1)' : 'none'
  row.style.paddingLeft = pad.left ? pad.left + 'px' : ''
  row.style.paddingRight = pad.right ? pad.right + 'px' : ''
  row.style.paddingBottom = pad.bottom ? pad.bottom + 'px' : ''
  if (!any) row.removeAttribute(PAD_ATTR)
}
// A chrome row that has just been mounted (entering app mode builds its row fresh) takes the
// current padding at once. Mutation callbacks run before the browser paints, so it never shows
// a frame laid out without the docks and then slides into place.
function padNewRows() {
  if (!(lastPad.left || lastPad.right || lastPad.bottom)) return
  for (const row of chromeRows()) if (!row.hasAttribute(PAD_ATTR)) padRow(row, lastPad, false)
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
  reserve: number // px of ComfyUI's chrome row this dock covers (gutter + rail + gutter + body)
}
export type DockLayout = Record<DockSidePos, ZoneLayout>

// Graph stats (LiteGraph's T/I/N/V/FPS overlay) pinned to the canvas's far-left edge, clear of
// any left or bottom dock. The frontend otherwise parks them beside its sidebar; what it had is
// restored when unpinned.
type StatsLocation = [number | null | undefined, number | null | undefined] | null
type StatsCanvas = {
  fpsInfoLocation?: StatsLocation
  setDirty?: (fg: boolean, bg: boolean) => void
}
let statsPinned = false
let statsBefore: StatsLocation | undefined
let statsWanted: StatsLocation = null
let relayout: (() => void) | null = null
const STATS_LINE = 13
function statsCanvas(): StatsCanvas | null {
  return (window as unknown as { app?: { canvas?: StatsCanvas } }).app?.canvas ?? null
}
function applyStats() {
  const c = statsCanvas()
  if (!c || !statsPinned) return
  const [x, y] = c.fpsInfoLocation ?? [null, null]
  if (x === statsWanted?.[0] && y === statsWanted?.[1]) return
  c.fpsInfoLocation = statsWanted
  c.setDirty?.(true, false)
}
export function setStatsPinned(on: boolean) {
  const c = statsCanvas()
  if (on === statsPinned) return
  statsPinned = on
  if (on) {
    statsBefore = c?.fpsInfoLocation ?? null
    relayout?.()
  } else if (c && statsBefore !== undefined) {
    c.fpsInfoLocation = statsBefore
    c.setDirty?.(true, false)
    statsBefore = undefined
  }
}

/** Bumped on every re-layout, so views that draw from computeDockLayout redraw with it. */
export const dockLayoutVersion = ref(0)

/** A floating taskbar is an inset card over the canvas; only the bottom one can float. */
export function taskbarFloats(store: PanelStore): boolean {
  return store.state.taskbarFloating && store.state.taskbarPos === 'bottom'
}
/** How far up from the window's bottom edge the taskbar reaches (to its top edge). */
export function taskbarFootprint(store: PanelStore): number {
  if (store.state.taskbarPos !== 'bottom') return 0
  return taskbarFloats(store) ? TASKBAR_H + canvasGutter() : TASKBAR_H
}

/** The area docks lay out in: the visible chrome row, above a bottom taskbar. */
export function dockBounds(store: PanelStore) {
  const row = visibleChromeRow()?.getBoundingClientRect()
  return {
    L: row?.left ?? 0,
    R: row?.right ?? window.innerWidth,
    T: row?.top ?? topbarHeight(),
    // App mode's row runs under a bottom taskbar, so the viewport bounds it too.
    B: Math.min(row?.bottom ?? Infinity, window.innerHeight - taskbarFootprint(store)),
    g: canvasGutter(),
  }
}

// Dock geometry: rail/body cards per side, inset in the visible chrome row.
export function computeDockLayout(store: PanelStore): DockLayout {
  const { L, R, T, B, g } = dockBounds(store)
  const W = R - L
  const H = B - T
  const zoneFor = (side: DockSidePos): ZoneLayout => {
    const members = store._ops.dockMembers(side)
    const z = store.state.docks[side]
    const activeId = members.some((p) => p.id === z.active) ? z.active : (members[0]?.id ?? null)
    const collapsed = z.collapsed
    if (!members.length)
      return { side, members, activeId: null, collapsed, rail: null, body: null, reserve: 0 }
    if (side === 'bottom') {
      // No rail of its own: the taskbar is the bottom dock's tab strip.
      const size = clamp(z.size, DOCK.minH, Math.min(DOCK.maxH, Math.floor(H * 0.66)))
      return {
        side,
        members,
        activeId,
        collapsed,
        rail: null,
        body: collapsed ? null : { x: L, y: B - g - size, w: W, h: size },
        reserve: collapsed ? 0 : g + size,
      }
    }
    const size = clamp(z.size, DOCK.minW, Math.min(DOCK.maxW, Math.floor(W * 0.66)))
    const h = H - g * 2
    const reserve = g + RAIL + (collapsed ? 0 : g + size)
    if (side === 'left')
      return {
        side,
        members,
        activeId,
        collapsed,
        rail: { x: L + g, y: T + g, w: RAIL, h },
        body: collapsed ? null : { x: L + g + RAIL + g, y: T + g, w: size, h },
        reserve,
      }
    return {
      side,
      members,
      activeId,
      collapsed,
      rail: { x: R - g - RAIL, y: T + g, w: RAIL, h },
      body: collapsed ? null : { x: R - g - RAIL - g - size, y: T + g, w: size, h },
      reserve,
    }
  }
  const left = zoneFor('left')
  const right = zoneFor('right')
  const bottom = zoneFor('bottom')
  // The bottom zone spans between the side docks, a gutter clear of each.
  if (bottom.body) {
    const bx = L + left.reserve + g
    bottom.body = { ...bottom.body, x: bx, w: Math.max(0, R - right.reserve - g - bx) }
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
    // Panels left-docked before the left side became ComfyUI's sidebar move into it.
    if (store.state.sidebarAvailable)
      for (const p of store._ops.dockMembers('left')) store._ops.setDock(p.id, 'left')
    const tbTop = store.state.taskbarPos === 'top'
    reserveTop(store, tbTop ? TASKBAR_H : 0) // before measuring, so topbarHeight() is current
    // An embedded taskbar is the only thing that takes space from the canvas, and only once.
    // A floating one sits over the canvas; ComfyUI's chrome is padded clear of it instead.
    const floats = taskbarFloats(store)
    const underBar = floats ? TASKBAR_H + canvasGutter() : 0
    let resized = setFloatingBarInset(underBar)
    resized = reserve('bottom', tbTop || floats ? 0 : TASKBAR_H) || resized
    resized = reserve('left', 0) || resized
    resized = reserve('right', 0) || resized
    if (resized) nudgeCanvas()
    const layout = computeDockLayout(store)
    for (const side of DOCK_SIDES) {
      // stack all members on the body rect; ZenPanel shows only the active tab
      const target = layout[side].body
      if (target) for (const p of layout[side].members) Object.assign(p, target)
    }
    padChrome(
      {
        left: layout.left.reserve,
        right: layout.right.reserve,
        bottom: layout.bottom.reserve + underBar,
      },
      !store.state.interacting,
    )
    dockLayoutVersion.value++
    if (statsPinned) {
      const g = canvasGutter()
      const canvasH = document.getElementById('graph-canvas')?.clientHeight ?? 0
      const clearBelow = layout.bottom.reserve + underBar
      statsWanted = [
        layout.left.reserve + g,
        clearBelow && canvasH ? canvasH - clearBelow - 7 * STATS_LINE : null,
      ]
      applyStats()
    }
  }
  relayout = recompute
  // A resize drag changes the dock size on every pointer move; lay out once per frame.
  let frame = 0
  function scheduleRecompute() {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      recompute()
    })
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
      return d + '#' + p + '#' + store.state.taskbarPos + ':' + store.state.taskbarFloating
    },
    scheduleRecompute,
    { immediate: true },
  )
  window.addEventListener('resize', recompute)
  // Switching graph <-> app mode swaps which chrome row is showing; re-lay the docks into it.
  let lastRow: HTMLElement | null = null
  let rowFrame = 0
  function checkRow() {
    rowFrame = 0
    const row = visibleChromeRow()
    if (row !== lastRow) {
      lastRow = row
      recompute()
    }
  }
  new MutationObserver(() => {
    padNewRows()
    if (!rowFrame) rowFrame = requestAnimationFrame(checkRow)
  }).observe(document.body, { childList: true, subtree: true })
  window.setInterval(() => {
    checkRow()
    // The frontend re-parks the stats when its sidebar changes size or side; take them back.
    applyStats()
  }, 400)
}
