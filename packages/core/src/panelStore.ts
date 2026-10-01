// Window-manager store: floating/snapping/docking panel state + ops.

import { markRaw, reactive, type InjectionKey } from 'vue'
import type { ZenBus } from './bus'
import { setSidebarAutohide as applySidebarAutohide } from './sidebarAutohide'
import type { DockDrop } from './dockDrop'
import { ensureStyle, removeStyle } from './dom'
import { zdebug, zlog } from './log'
import { focusTiles, isTiled } from './tileStore'
import type {
  DockSide,
  PanelApi,
  PanelContext,
  PanelHandle,
  PanelRegistration,
  PanelSpec,
  PanelStatus,
  Rect,
} from './types'

export interface Panel extends Rect {
  id: string
  title: string
  icon: string
  render: (el: HTMLElement, ctx?: PanelContext) => void | (() => void)
  cleanup: (() => void) | null
  z: number
  status: PanelStatus
  minWidth: number
  minHeight: number
  dockSide: DockSide
  /** Where the panel lives when it is free-floating. Every other layout — maximized, snapped,
   *  docked, pinned in the sidebar — is somewhere it is *shown*, and leaving it comes back here.
   *  Only a move or resize of the free panel itself changes it. */
  floatRect: Rect | null
  /** Filling a snap zone (half the screen, a quarter…). */
  snapped: boolean
  ctx: PanelContext
  headerHidden: boolean // header collapsed to a thin draggable sliver
  headerPos: 'top' | 'bottom' // header/sliver at the top or bottom (footer)
  dockOrder: number // sort key among the panels sharing this dock side (tab order)
  instanceOf: string | null // registration id when this is one instance of a multi panel
  persist: boolean // save/restore geometry + ctx state across reloads
  inSidebar: boolean // hosted in ComfyUI's native sidebar (hidden from the host overlay)
  maximized: boolean // maximize pin; persisted, re-derived against the current viewport
  frame: 'default' | 'none' // 'none' = bare/transparent/click-through, consumer-rendered chrome
  customTitle: string | null // set through setTitle; persisted over the registered title
}

// Per-zone tab-group state; tab membership lives on the panels (`dockSide`).
export interface DockZone {
  active: string | null
  collapsed: boolean
  size: number
}
export type DockSidePos = 'left' | 'right' | 'bottom'
export const DOCK_SIDES: DockSidePos[] = ['left', 'right', 'bottom']
const DOCK_DEFAULT_SIZE: Record<DockSidePos, number> = { left: 320, right: 320, bottom: 300 }

const LS = 'zenkit.panels.v1'
const DOCKS_LS = 'zenkit.docks.v1'
const BRAND_LS = 'zenkit.branding.v1'
const TASK_ORDER_LS = 'zenkit.taskorder.v1'
let zTop = 20

// Start-button branding. Two settable layers over COMFY_BRAND, resolved into `state.branding`
// (the only one chrome should render):
//   base — the distributor's, from installZenKit({ branding }) / ZenKit.setBranding(). Not
//          persisted: it is re-declared on every boot by whoever ships the build.
//   user — the local override typed into Zen Settings. Persisted; wins field-by-field.
// An empty string at either layer means "inherit", so clearing a field in Settings falls back
// to the distributor's brand and, failing that, to COMFY_BRAND. `logo` accepts an image
// URL/data URI OR an MDI class ("mdi mdi-rocket-launch") — chrome renders it through ZenIcon.
export interface Branding {
  logo: string
  title: string
}
/** Unbranded default: ComfyUI's own name and the logo asset ComfyUI serves. */
export const COMFY_BRAND: Branding = {
  logo: '/assets/images/comfy-logo-single.svg',
  title: 'Comfy',
}

// Instance ids are `${typeId}#<n>`; typeIdOf returns the part before '#'.
const INSTANCE_SEP = '#'
export const typeIdOf = (id: string) => {
  const i = id.indexOf(INSTANCE_SEP)
  return i === -1 ? id : id.slice(0, i)
}

const vw = () => window.innerWidth
const vh = () => window.innerHeight

// Usable vertical band for floating panels = viewport minus ComfyUI's reserved top cell
// (menu, + the taskbar when it's docked on top) and bottom cell (the taskbar when at the
// bottom, + any bottom dock). Falls back to the full viewport if those cells are absent.
function safeBand(): { top: number; bottom: number } {
  let top = 0
  let bottom = vh()
  try {
    const t = document.getElementById('comfyui-body-top')
    const b = document.getElementById('comfyui-body-bottom')
    if (t) top = t.offsetHeight
    if (b) bottom = vh() - b.offsetHeight
  } catch {
    /* ignore */
  }
  bottom = Math.min(bottom, vh() - floatingBarInset)
  return { top, bottom: Math.max(top + 1, bottom) }
}

// A floating taskbar reserves no cell (it sits over the canvas), so the band can't measure it;
// tiling reports how far up it reaches instead.
let floatingBarInset = 0
/** Returns whether the inset changed, so the caller can re-fit what depends on the band. */
export function setFloatingBarInset(px: number): boolean {
  if (px === floatingBarInset) return false
  floatingBarInset = px
  return true
}

// Viewport metrics used by section-anchoring: full width + the safe band's top/bottom.
export interface Viewport {
  W: number
  T: number
  B: number
}
function viewport(): Viewport {
  const { top, bottom } = safeBand()
  return { W: vw(), T: top, B: bottom }
}

export function clampRect(r: Rect, minW: number, minH: number): Rect {
  // keep the whole panel within the safe band (off the menu/taskbar), cap size first
  const { top, bottom } = safeBand()
  const w = Math.max(minW, Math.min(r.w, vw()))
  const h = Math.max(minH, Math.min(r.h, bottom - top))
  const x = Math.max(0, Math.min(r.x, Math.max(0, vw() - w)))
  const y = Math.max(top, Math.min(r.y, Math.max(top, bottom - h)))
  return { x, y, w, h }
}

//: Inset from the safe band, so a maximized panel still reads as a window rather than a
//: chromeless takeover.
const MAX_GAP = 6

// The rect a maximized panel fills, from the LIVE safe band.
//
// Derived rather than stored, because "maximized" is a relationship to the viewport and not a
// size. It used to be computed once, at the moment of maximizing, and then carried like any
// other float geometry: the resize handler reanchored it with `w`/`h` held fixed, so a panel
// maximized on a wide screen was clamped smaller when the viewport shrank and never grew back
// when it returned. Recomputing means the panel tracks the screen in both directions, and it
// also re-fills when the band itself moves — the taskbar changing edge, a dock opening, or
// ComfyUI's top menu resizing all reach us as the synthetic resize `tiling.nudgeCanvas` fires.
export function maximizedRect(minW: number, minH: number): Rect {
  const { top, bottom } = safeBand()
  const g = MAX_GAP
  return clampRect({ x: g, y: top + g, w: vw() - g * 2, h: bottom - top - g * 2 }, minW, minH)
}

// Centered default floating rect — used on reset and on undock when no prior float size.
function centeredDefaultRect(minW: number, minH: number): Rect {
  const w = Math.min(900, Math.max(minW, Math.floor(vw() * 0.6)))
  const h = Math.min(620, Math.max(minH, Math.floor(vh() * 0.7)))
  return clampRect({ x: (vw() - w) / 2, y: (vh() - h) / 2, w, h }, minW, minH)
}

// Snap zone for a pointer near the edges: corners→quadrants, sides→halves, top→maximize.
export function snapZoneFor(px: number, py: number): Rect | null {
  const W = vw()
  const { top: T, bottom: B } = safeBand()
  const AH = B - T // available height inside the safe band
  const g = 6
  const EDGE = 26
  const CORNER = 90
  const hw = Math.floor(W / 2)
  const hh = Math.floor(AH / 2)
  const nL = px <= EDGE
  const nR = px >= W - EDGE
  const nT = py <= T + EDGE
  const nB = py >= B - EDGE
  if (px <= CORNER && py <= T + CORNER && (nL || nT))
    return { x: g, y: T + g, w: hw - g * 1.5, h: hh - g * 1.5 }
  if (px >= W - CORNER && py <= T + CORNER && (nR || nT))
    return { x: hw + g * 0.5, y: T + g, w: hw - g * 1.5, h: hh - g * 1.5 }
  if (px <= CORNER && py >= B - CORNER && (nL || nB))
    return { x: g, y: T + hh + g * 0.5, w: hw - g * 1.5, h: hh - g * 1.5 }
  if (px >= W - CORNER && py >= B - CORNER && (nR || nB))
    return { x: hw + g * 0.5, y: T + hh + g * 0.5, w: hw - g * 1.5, h: hh - g * 1.5 }
  // (drag-to-top maximize removed — use the header maximize button / double-click instead)
  if (nL) return { x: g, y: T + g, w: hw - g * 1.5, h: AH - g * 2 }
  if (nR) return { x: hw + g * 0.5, y: T + g, w: hw - g * 1.5, h: AH - g * 2 }
  return null
}

// Which screen section a panel belongs to — its "pin". Derived from the live rect
// (never stored): a panel anchors to whichever edge it's nearest, with a center
// dead-zone where the two gaps are nearly equal. Vertical is measured against the
// safe band (off the menu/taskbar). This drives reanchoring on viewport/content
// resize so a panel parked in, say, the bottom-right stays in the bottom-right.
export type SectionH = 'left' | 'center' | 'right'
export type SectionV = 'top' | 'center' | 'bottom'
export interface Section {
  h: SectionH
  v: SectionV
}
// Fraction of each axis around its midpoint that still counts as "centered".
const CENTER_FRAC = 0.15
export function sectionFor(r: Rect, vp: Viewport): Section {
  const leftGap = r.x
  const rightGap = vp.W - (r.x + r.w)
  const topGap = r.y - vp.T
  const botGap = vp.B - (r.y + r.h)
  const h: SectionH =
    Math.abs(leftGap - rightGap) < vp.W * CENTER_FRAC
      ? 'center'
      : leftGap < rightGap
        ? 'left'
        : 'right'
  const v: SectionV =
    Math.abs(topGap - botGap) < (vp.B - vp.T) * CENTER_FRAC
      ? 'center'
      : topGap < botGap
        ? 'top'
        : 'bottom'
  return { h, v }
}

export type PanelStore = ReturnType<typeof createPanelStore>
export const STORE_KEY: InjectionKey<PanelStore> = Symbol('zenkit-store')

export function createPanelStore(bus: ZenBus) {
  const state = reactive({
    list: [] as Panel[],
    snap: null as Rect | null,
    // side a dragged floating panel would dock into (edge preview)
    dockDrop: null as DockDrop | null,
    finderOpen: false, // the cmd+K Finder overlay
    registry: [] as PanelRegistration[],
    // true while dragging/resizing — ZenHost shields the graph beneath
    interacting: false,
    dockEdgeLit: null as DockSidePos | null, // the dock whose resize edge is hovered or dragged
    interactCursor: '',
    // resolved branding (user over base) — read this from chrome; write via the setters
    branding: { logo: '', title: '' } as Branding,
    brandingBase: { logo: '', title: '' } as Branding, // distributor's (install opts / API)
    brandingUser: { logo: '', title: '' } as Branding, // local override (Zen Settings)
    minimizedAnchor: 'center' as 'left' | 'center' | 'right',
    docks: loadDocks() as Record<DockSidePos, DockZone>,
    sidebarAvailable: false, // ComfyUI native sidebar present → "Pin to sidebar" enabled
    panelsHidden: false, // taskbar "show desktop" toggle — hide all panels without minimizing
    taskbarPos: 'bottom' as 'top' | 'bottom', // permanent taskbar edge
    taskbarFloating: false, // bottom taskbar as an inset, rounded card over the canvas instead of an embedded strip
    topbarH: 0, // natural ComfyUI top-menu height (tiling fills this; taskbar sits below it when on top)
    absorbComfyButtons: true, // hide ComfyUI's sidebar-bottom buttons + surface them in the menu
    sidebarAutohide: false, // auto-hide ComfyUI's native left side-toolbar (reveal on edge hover)
    floatingSidebar: true, // restyle ComfyUI's opened sidebar content into a contained floating card (on by default; opt out via the "Restyle sidebar" toggle)
    themedSplash: true, // draw ComfyUI's startup splash in the active ZenKit theme (from the next load)
    comfyThemeMenu: true, // EXPERIMENTAL: inject a ZenKit theme block into ComfyUI's logo→Theme menu (on by default; opt out)
    pluginsDisabled: [] as string[], // ZenKit-level disabled plugins (hidden from launcher/taskbar)
    taskOrder: [] as string[], // user order of the taskbar's window buttons (ids; unknown ids sort last)
  })
  try {
    if (localStorage.getItem('zenkit.taskbar.v1') === 'top') state.taskbarPos = 'top'
    if (localStorage.getItem('zenkit.taskbarfloat.v1') === '1') state.taskbarFloating = true
    if (localStorage.getItem('zenkit.absorbcomfy.v1') === '0') state.absorbComfyButtons = false
    if (localStorage.getItem('zenkit.sidebarautohide.v1') === '1') state.sidebarAutohide = true
    if (localStorage.getItem('zenkit.floatingsidebar.v1') === '0') state.floatingSidebar = false // default on; only an explicit opt-out disables it
    if (localStorage.getItem('zenkit.themedsplash.v1') === '0') state.themedSplash = false
    if (localStorage.getItem('zenkit.comfythememenu.v1') === '0') state.comfyThemeMenu = false // default on; only an explicit opt-out disables it
    const to = JSON.parse(localStorage.getItem(TASK_ORDER_LS) || '[]')
    if (Array.isArray(to)) state.taskOrder = to.map(String)
    const pd = JSON.parse(localStorage.getItem('zenkit.plugins.disabled.v1') || '[]')
    if (Array.isArray(pd)) state.pluginsDisabled = pd.map(String)
    const brand = JSON.parse(localStorage.getItem(BRAND_LS) || '{}') || {}
    if (typeof brand.logo === 'string') state.brandingUser.logo = brand.logo
    if (typeof brand.title === 'string') state.brandingUser.title = brand.title
  } catch {
    /* ignore */
  }
  // Sidebar-autohide controller state (declared before the apply call below, which
  // runs during store creation — these must be initialized first).
  resolveBranding()
  applyComfyBarHide(state.absorbComfyButtons)
  applySidebarAutohide(state.sidebarAutohide)
  applyFloatingSidebar(state.floatingSidebar)

  function loadDocks(): Record<DockSidePos, DockZone> {
    const def = (): Record<DockSidePos, DockZone> => ({
      left: { active: null, collapsed: false, size: DOCK_DEFAULT_SIZE.left },
      right: { active: null, collapsed: false, size: DOCK_DEFAULT_SIZE.right },
      bottom: { active: null, collapsed: false, size: DOCK_DEFAULT_SIZE.bottom },
    })
    try {
      const saved = JSON.parse(localStorage.getItem(DOCKS_LS) || '{}') || {}
      const out = def()
      for (const s of DOCK_SIDES) if (saved[s]) out[s] = { ...out[s], ...saved[s] }
      return out
    } catch {
      return def()
    }
  }
  const saveDocks = () => {
    try {
      localStorage.setItem(DOCKS_LS, JSON.stringify(state.docks))
    } catch {
      /* ignore */
    }
  }

  type Geom = Record<
    string,
    Rect & {
      status?: PanelStatus
      dockSide?: DockSide
      headerHidden?: boolean
      headerPos?: 'top' | 'bottom'
      dockOrder?: number
      floatRect?: Rect | null
      snapped?: boolean
      inSidebar?: boolean
      maximized?: boolean
      customTitle?: string | null
      /** Older saves kept two restore rects; read once as `floatRect`. */
      restoreRect?: Rect | null
      preMax?: Rect | null
    }
  >
  const loadGeom = (): Geom => {
    try {
      return JSON.parse(localStorage.getItem(LS) || '{}') || {}
    } catch {
      return {}
    }
  }
  const saveGeom = () => {
    // merge, don't rebuild — restore re-opens panels one at a time; close() forgets.
    const out: Geom = loadGeom()
    for (const p of state.list) {
      if (!p.persist) continue // ephemeral panels are never saved/restored
      out[p.id] = {
        x: p.x,
        y: p.y,
        w: p.w,
        h: p.h,
        status: p.status,
        dockSide: p.dockSide,
        headerHidden: p.headerHidden,
        headerPos: p.headerPos,
        dockOrder: p.dockOrder,
        floatRect: p.floatRect,
        snapped: p.snapped,
        inSidebar: p.inSidebar,
        // Persisted so a maximized panel comes back maximized instead of decaying into a float
        // that merely happens to be the old screen's size; `floatRect` is what un-maximizing
        // returns to (x/y/w/h above are the MAXIMIZED rect while the pin is on).
        maximized: p.maximized,
        customTitle: p.customTitle,
      }
    }
    try {
      localStorage.setItem(LS, JSON.stringify(out))
    } catch {
      /* ignore */
    }
  }
  // Drop a panel from persisted geometry so it won't restore next session.
  const forgetGeom = (id: string) => {
    const all = loadGeom()
    if (id in all) {
      delete all[id]
      try {
        localStorage.setItem(LS, JSON.stringify(all))
      } catch {
        /* ignore */
      }
    }
  }

  // Per-panel content state (e.g. a panel's active tab), separate from geometry.
  const STATE_LS = 'zenkit.panelstate.v1'
  const loadStates = (): Record<string, unknown> => {
    try {
      return JSON.parse(localStorage.getItem(STATE_LS) || '{}') || {}
    } catch {
      return {}
    }
  }
  const saveState = (id: string, blob: unknown) => {
    const all = loadStates()
    all[id] = blob
    try {
      const json = JSON.stringify(all)
      localStorage.setItem(STATE_LS, json)
      console.debug('[ZenKit] saveState', id, '·', (json.length / 1024).toFixed(1) + 'KB')
    } catch (e) {
      console.warn(
        '[ZenKit] saveState FAILED for',
        id,
        '— blob',
        (JSON.stringify(blob).length / 1024).toFixed(1) + 'KB',
        e,
      )
    }
  }
  const forgetState = (id: string) => {
    const all = loadStates()
    if (!(id in all)) return
    delete all[id]
    try {
      localStorage.setItem(STATE_LS, JSON.stringify(all))
    } catch {
      /* ignore */
    }
  }
  // What each mounted panel exposes about itself (PanelContext.expose); not persisted.
  const exposed = new Map<string, PanelApi>()

  // last session's geometry, snapshotted before any save; drives restore in register()
  const RESTORE = loadGeom()
  if (Object.keys(RESTORE).length) zdebug('session restore candidates:', Object.keys(RESTORE))

  const get = (id: string) => state.list.find((p) => p.id === id)
  const emit = (event: string, id: string) => bus.emit('panel:' + event, { id })

  // Panels docked to a side, in tab order. Minimized ones drop out of the rail.
  const dockMembers = (side: DockSidePos) =>
    state.list
      .filter((p) => p.dockSide === side && p.status !== 'minimized')
      .sort((a, b) => a.dockOrder - b.dockOrder)
  const nextDockOrder = (side: DockSidePos) =>
    dockMembers(side).reduce((m, p) => Math.max(m, p.dockOrder), -1) + 1
  // Keep each zone's `active` pointing at a real member; pick the first if it's
  // gone empty/dangling. Called after any change to membership.
  function reconcileDocks() {
    for (const side of DOCK_SIDES) {
      const z = state.docks[side]
      const members = dockMembers(side)
      // during restore, keep a saved active id even if its panel isn't open yet
      if (!members.some((p) => p.id === z.active) && !(restoring && z.active))
        z.active = members[0]?.id ?? null
    }
    saveDocks()
  }
  // Set true only while register() replays last session's panels (see below).
  let restoring = false

  // Keep floating panels anchored to their screen section across viewport resizes
  // (docked ones are placed by tiling.ts; sidebar-hosted ones aren't ours to move).
  // Classify each panel in the PREVIOUS viewport, then shift it so it keeps its
  // relationship to the edge(s) it's nearest — then clamp to stay on-screen.
  let prevVP = viewport()
  window.addEventListener('resize', () => {
    const vp = viewport()
    const dW = vp.W - prevVP.W
    const dT = vp.T - prevVP.T
    const dB = vp.B - prevVP.B
    let changed = false
    for (const p of state.list) {
      if (p.dockSide || p.inSidebar) continue
      // Maximized is pinned to the band, not anchored to a screen section: re-fill it. The
      // section math below deliberately preserves `w`/`h`, which is right for a float and wrong
      // for this — that is the whole bug, see `maximizedRect`.
      if (p.maximized) {
        const m = maximizedRect(p.minWidth, p.minHeight)
        if (m.x !== p.x || m.y !== p.y || m.w !== p.w || m.h !== p.h) {
          Object.assign(p, m)
          changed = true
        }
        continue
      }
      const sec = sectionFor(p, prevVP)
      let x = p.x
      let y = p.y
      if (sec.h === 'right') x += dW
      else if (sec.h === 'center') x += dW / 2
      if (sec.v === 'top') y += dT
      else if (sec.v === 'bottom') y += dB
      else y += (dT + dB) / 2
      const c = clampRect({ x, y, w: p.w, h: p.h }, p.minWidth, p.minHeight)
      if (c.x !== p.x || c.y !== p.y || c.w !== p.w || c.h !== p.h) {
        Object.assign(p, c)
        changed = true
      }
    }
    prevVP = vp // always advance, so deltas never accumulate
    if (changed) saveGeom()
  })

  // flush geometry on unload in case we close mid-interaction
  window.addEventListener('pagehide', () => saveGeom())

  // Mint a unique `${typeId}#<n>` id, avoiding both open panels and saved geometry.
  function mintInstanceId(typeId: string): string {
    const used = new Set<string>([...state.list.map((p) => p.id), ...Object.keys(loadGeom())])
    let n = 1
    let id = `${typeId}${INSTANCE_SEP}${n}`
    while (used.has(id)) id = `${typeId}${INSTANCE_SEP}${++n}`
    return id
  }

  // A panel's body remounts whenever it moves (docked, pinned, popped out), so `state` must
  // read what was last set, not what was loaded when the panel opened.
  function panelContext(id: string, persist: boolean): PanelContext {
    let state = persist ? loadStates()[id] : undefined
    return {
      id,
      get state() {
        return state
      },
      setState: (s: unknown) => {
        state = s
        if (persist) saveState(id, s)
      },
      expose: (api: PanelApi) => {
        exposed.set(id, api)
        return () => {
          if (exposed.get(id) === api) exposed.delete(id)
        }
      },
    }
  }

  // Instances of a multi panel are told apart by number: "Media Viewer", "Media Viewer 2", …
  function instanceTitle(spec: PanelSpec, id: string): string {
    const n = spec.instanceOf ? Number(id.slice(id.lastIndexOf(INSTANCE_SEP) + 1)) : NaN
    return n > 1 ? `${spec.title} ${n}` : spec.title
  }

  function open(spec: PanelSpec): PanelHandle {
    const persist = spec.persist !== false
    // Resolve the id: explicit, else mint a fresh instance id for `instanceOf`.
    const id = spec.id || (spec.instanceOf ? mintInstanceId(spec.instanceOf) : '')
    if (!id) {
      console.error('[ZenKit] panels.open needs an id or instanceOf', spec)
      return makeHandle('')
    }
    // If this panel already lives in the tiling area, surface the Tile Area instead
    // of floating a second copy (which would render the content twice).
    if (isTiled(id)) {
      focusTiles()
      return makeHandle(id)
    }
    if (get(id)) {
      reveal(id)
      return makeHandle(id)
    }
    // Bare (chromeless) panels size to their content, so the windowed min floors
    // don't apply — clamp/anchor math must use the real footprint, not a 360px floor.
    const bareFrame = spec.frame === 'none'
    const minWidth = spec.minWidth ?? (bareFrame ? 0 : 360)
    const minHeight = spec.minHeight ?? (bareFrame ? 0 : 280)
    const saved = persist ? loadGeom()[id] : undefined
    const i = state.list.length
    const base: Rect = saved ?? {
      x: 120 + i * 28,
      y: 96 + i * 28,
      w: spec.width ?? 900,
      h: spec.height ?? 620,
    }
    // A restored maximized panel is re-filled from the current band, not from the saved rect —
    // the session that saved it may have been on a different screen.
    const rect = saved?.maximized
      ? maximizedRect(minWidth, minHeight)
      : clampRect(base, minWidth, minHeight)
    state.list.push({
      ...rect,
      id,
      title: saved?.customTitle ?? instanceTitle(spec, id),
      customTitle: saved?.customTitle ?? null,
      icon: spec.icon ?? 'mdi mdi-application-outline',
      render: markRaw(spec.render),
      cleanup: null,
      z: ++zTop,
      status: 'open', // explicit opens are active; restore applies saved status
      minWidth,
      minHeight,
      dockSide: spec.dock ?? saved?.dockSide ?? null,
      floatRect: saved?.floatRect ?? saved?.restoreRect ?? saved?.preMax ?? (saved ? null : rect),
      snapped: !!saved?.snapped || (!!saved?.restoreRect && !saved?.dockSide && !saved?.inSidebar),
      ctx: panelContext(id, persist),
      headerHidden: saved?.headerHidden ?? false,
      headerPos: saved?.headerPos === 'bottom' ? 'bottom' : 'top',
      dockOrder: saved?.dockOrder ?? 0,
      instanceOf: spec.instanceOf ?? null,
      persist,
      inSidebar: saved?.inSidebar ?? false,
      maximized: !!saved?.maximized,
      frame: spec.frame === 'none' ? 'none' : 'default',
    })
    const opened = get(id)!
    if (opened.dockSide) {
      // joining a rail: append + activate, but don't clobber saved state during restore
      if (saved?.dockOrder == null) opened.dockOrder = nextDockOrder(opened.dockSide)
      const z = state.docks[opened.dockSide as DockSidePos]
      if (!restoring) {
        z.active = id
        z.collapsed = false
      }
      reconcileDocks()
    }
    if (persist) saveGeom()
    emit('open', id)
    return makeHandle(id)
  }

  function close(id: string) {
    // removal unmounts the panel (runs render cleanup); minimize keeps it mounted
    const i = state.list.findIndex((p) => p.id === id)
    const wasDocked = i >= 0 ? state.list[i].dockSide : null
    if (i >= 0) state.list.splice(i, 1)
    // Closing forgets the panel: it won't restore next session, and opening it again starts fresh.
    forgetGeom(id)
    forgetState(id)
    exposed.delete(id)
    if (wasDocked) reconcileDocks()
    emit('close', id)
  }
  function minimize(id: string) {
    const p = get(id)
    if (p) {
      p.status = 'minimized'
      if (p.dockSide) reconcileDocks() // drops out of the rail; hand active to a sibling
      saveGeom()
      emit('minimize', id)
    }
  }
  function restore(id: string) {
    const p = get(id)
    if (p) {
      p.status = 'open'
      if (p.dockSide) {
        // Rejoin the rail as the active tab; floating panels come to the front.
        const z = state.docks[p.dockSide as DockSidePos]
        z.active = id
        z.collapsed = false
        reconcileDocks()
      } else front(id)
      saveGeom()
      emit('restore', id)
    }
  }
  /** Bring an existing panel into view wherever it lives: un-minimise or unfold it, make it
   *  the active tab of an expanded dock, or switch ComfyUI's sidebar to it when pinned there. */
  function reveal(id: string) {
    const p = get(id)
    if (!p) return
    if (p.status !== 'open') restore(id)
    else if (p.dockSide) {
      const z = state.docks[p.dockSide as DockSidePos]
      z.active = id
      z.collapsed = false
      reconcileDocks()
    } else front(id)
    if (p.inSidebar) bus.emit('panel:reveal', { id })
  }
  function toggleFold(id: string) {
    const p = get(id)
    if (!p) return
    // docked panels collapse at the zone level (toggleDockCollapsed), not per-panel
    if (p.dockSide) return
    p.status = p.status === 'folded' ? 'open' : 'folded'
    saveGeom()
    emit('fold', id)
  }
  function front(id: string) {
    const p = get(id)
    if (p) p.z = ++zTop
    emit('focus', id)
  }
  /** Is the panel free right now — so its rect IS its float rect? */
  const isFree = (p: Panel) => !p.maximized && !p.snapped && !p.dockSide && !p.inSidebar
  /** Before a panel goes somewhere else, remember where it was free (if it was). */
  function rememberFloat(p: Panel) {
    if (isFree(p)) p.floatRect = { x: p.x, y: p.y, w: p.w, h: p.h }
  }
  /** Where to put a panel that is becoming free again. */
  function floatGeom(p: Panel): Rect {
    return p.floatRect
      ? clampRect(p.floatRect, p.minWidth, p.minHeight)
      : centeredDefaultRect(p.minWidth, p.minHeight)
  }

  function setRect(id: string, r: Partial<Rect>, persist = false) {
    const p = get(id)
    if (!p) return
    // Any manual drag/resize makes it free: out of maximized and out of its snap zone.
    p.maximized = false
    p.snapped = false
    Object.assign(
      p,
      clampRect(
        { x: r.x ?? p.x, y: r.y ?? p.y, w: r.w ?? p.w, h: r.h ?? p.h },
        p.minWidth,
        p.minHeight,
      ),
    )
    if (isFree(p)) p.floatRect = { x: p.x, y: p.y, w: p.w, h: p.h }
    if (persist) saveGeom()
  }
  // A content-sized (bare) panel reported a new measured footprint. Resize the stored
  // rect while keeping its anchored corner fixed — so e.g. a bottom-right mascot grows
  // toward the center instead of sliding off-screen. The section is derived from the
  // live position, exactly like the viewport-resize reanchor.
  function setContentSize(id: string, w: number, h: number) {
    const p = get(id)
    if (!p) return
    // While maximized the band owns the rect. Letting a content measurement through would
    // resize the panel out from under the pin, and the next resize event would snap it back.
    if (p.maximized) return
    if (w <= 0 || h <= 0 || (w === p.w && h === p.h)) return
    const sec = sectionFor(p, viewport())
    const dw = w - p.w
    const dh = h - p.h
    let x = p.x
    let y = p.y
    if (sec.h === 'right') x -= dw
    else if (sec.h === 'center') x -= dw / 2
    if (sec.v === 'bottom') y -= dh
    else if (sec.v === 'center') y -= dh / 2
    Object.assign(p, clampRect({ x, y, w, h }, p.minWidth, p.minHeight))
    saveGeom()
  }
  // Maximize fills the safe band (off the menu/taskbar); toggling restores the float geom.
  function toggleMaximize(id: string) {
    const p = get(id)
    if (!p || p.dockSide) return // docked panels resize via the rail, not maximize
    if (p.maximized) {
      p.maximized = false
      p.snapped = false
      Object.assign(p, floatGeom(p))
    } else {
      rememberFloat(p)
      Object.assign(p, maximizedRect(p.minWidth, p.minHeight))
      p.maximized = true
      if (p.status !== 'open') p.status = 'open'
      front(id)
    }
    saveGeom()
    emit('maximize', id)
  }
  function setTitle(id: string, title: string) {
    const p = get(id)
    if (!p) return
    p.title = title
    p.customTitle = title
    saveGeom()
  }
  function setIcon(id: string, icon: string) {
    const p = get(id)
    if (p) p.icon = icon
  }
  function setDock(id: string, side: DockSide) {
    // The left side is ComfyUI's own sidebar now: docking there pins into it.
    if (side === 'left') {
      if (state.sidebarAvailable) pinSidebar(id)
      else setDock(id, 'right')
      return
    }
    const p = get(id)
    if (!p) return
    if (p.dockSide === side) return
    if (side) {
      // remember the floating rect, append to the rail as active tab, expand the zone
      rememberFloat(p)
      p.maximized = false
      p.snapped = false
      const order = nextDockOrder(side) // compute before joining so it appends last
      p.dockSide = side
      p.dockOrder = order
      p.status = 'open'
      const z = state.docks[side as DockSidePos]
      z.active = id
      z.collapsed = false
    } else {
      // undock: restore the saved floating rect, or a centered default if we never had one
      const from = p.dockSide as DockSidePos
      p.dockSide = null
      Object.assign(p, floatGeom(p))
      p.status = 'open'
      // pulling the visible tab out closes the dock (collapse to rail) rather than swapping to a sibling
      if (state.docks[from].active === id) state.docks[from].collapsed = true
      front(id)
    }
    reconcileDocks()
    saveGeom()
  }
  // Finish a panel drag on a drop target.
  function dropInto(id: string, target: DockDrop) {
    if (target === 'sidebar') pinSidebar(id)
    else setDock(id, target)
  }
  // A dock tab was clicked: show it, or tuck the zone away when it is already showing.
  function toggleDockTab(side: DockSidePos, id: string) {
    const z = state.docks[side]
    if (z.active === id && !z.collapsed) toggleDockCollapsed(side)
    else setDockActive(side, id)
  }
  // Surface a tab (make it the active, expanded one in its zone).
  function setDockActive(side: DockSidePos, id: string) {
    const z = state.docks[side]
    z.active = id
    z.collapsed = false
    saveDocks()
  }
  // Collapse a zone to just its rail (or re-expand it).
  function toggleDockCollapsed(side: DockSidePos) {
    state.docks[side].collapsed = !state.docks[side].collapsed
    saveDocks()
  }
  // Resize a zone's body extent (width for sides, height for bottom). tiling.ts
  // clamps it; we just store the request.
  function setDockSize(side: DockSidePos, px: number, persist = true) {
    state.docks[side].size = Math.max(120, Math.round(px))
    if (persist) saveDocks()
  }
  // Sort panels by the saved taskbar order; ones never placed keep their list order, after.
  function sortByTaskOrder<T extends { id: string }>(panels: T[]): T[] {
    const rank = (id: string) => {
      const i = state.taskOrder.indexOf(id)
      return i < 0 ? Number.MAX_SAFE_INTEGER : i
    }
    return panels
      .map((p, i) => ({ p, i }))
      .sort((a, b) => rank(a.p.id) - rank(b.p.id) || a.i - b.i)
      .map(({ p }) => p)
  }
  // move taskbar button `id` before `beforeId` (or last) within the shown `ids`
  function reorderTask(ids: string[], id: string, beforeId: string | null) {
    const next = ids.filter((m) => m !== id)
    const at = beforeId ? next.indexOf(beforeId) : next.length
    next.splice(at < 0 ? next.length : at, 0, id)
    state.taskOrder = next
    try {
      localStorage.setItem(TASK_ORDER_LS, JSON.stringify(next))
    } catch {
      /* ignore */
    }
  }
  // move `id` before `beforeId` (or last); redensify dockOrder
  function reorderDock(side: DockSidePos, id: string, beforeId: string | null) {
    const members = dockMembers(side)
      .map((p) => p.id)
      .filter((m) => m !== id)
    const at = beforeId ? members.indexOf(beforeId) : members.length
    members.splice(at < 0 ? members.length : at, 0, id)
    members.forEach((mid, i) => {
      const m = get(mid)
      if (m) m.dockOrder = i
    })
    saveGeom()
  }
  function applySnap(id: string, rect: Rect) {
    const p = get(id)
    if (!p) return
    rememberFloat(p)
    p.maximized = false
    p.snapped = true
    Object.assign(p, rect)
    p.status = 'open'
    saveGeom()
  }
  /** A panel's layout at the start of a gesture, so Escape can put it back exactly. */
  function snapshot(id: string) {
    const p = get(id)
    if (!p) return null
    const { x, y, w, h, maximized, snapped, floatRect } = p
    return { x, y, w, h, maximized, snapped, floatRect }
  }
  function restoreSnapshot(id: string, snap: ReturnType<typeof snapshot>) {
    const p = get(id)
    if (!p || !snap) return
    Object.assign(p, snap)
    saveGeom()
  }

  /** The size a maximized or snapped panel takes when it is pulled free; null when it is free. */
  function tearOffSize(id: string): { w: number; h: number } | null {
    const p = get(id)
    if (!p || isFree(p)) return null
    const r = floatGeom(p)
    return { w: r.w, h: r.h }
  }

  // toggle the drag/resize shield; cursor stays consistent over the shield
  function setInteract(on: boolean, cursor = '') {
    state.interacting = on
    state.interactCursor = on ? cursor : ''
  }

  // user over base over ComfyUI's own, field by field ('' = inherit). Always renderable.
  function resolveBranding() {
    state.branding.logo = state.brandingUser.logo || state.brandingBase.logo || COMFY_BRAND.logo
    state.branding.title = state.brandingUser.title || state.brandingBase.title || COMFY_BRAND.title
  }
  /** Distributor branding — the build's own name/logo. A local override still wins. */
  function setBranding(b: { logo?: string; title?: string }) {
    if (b.logo !== undefined) state.brandingBase.logo = b.logo
    if (b.title !== undefined) state.brandingBase.title = b.title
    resolveBranding()
  }
  /** The Zen Settings override (persisted). Pass '' for a field to fall back to setBranding()'s
   *  value, or {} — i.e. both fields cleared — to drop the override entirely. */
  function setBrandingOverride(b: { logo?: string; title?: string }) {
    if (b.logo !== undefined) state.brandingUser.logo = b.logo
    if (b.title !== undefined) state.brandingUser.title = b.title
    resolveBranding()
    try {
      const { logo, title } = state.brandingUser
      if (logo || title) localStorage.setItem(BRAND_LS, JSON.stringify({ logo, title }))
      else localStorage.removeItem(BRAND_LS)
    } catch {
      /* ignore */
    }
  }

  function setMinimizedAnchor(anchor: 'left' | 'center' | 'right') {
    state.minimizedAnchor = anchor === 'left' || anchor === 'right' ? anchor : 'center'
  }
  function setTaskbarFloating(on: boolean) {
    state.taskbarFloating = !!on
    try {
      localStorage.setItem('zenkit.taskbarfloat.v1', on ? '1' : '0')
    } catch {
      /* ignore */
    }
  }
  function setTaskbarPos(pos: 'top' | 'bottom') {
    state.taskbarPos = pos === 'top' ? 'top' : 'bottom'
    try {
      localStorage.setItem('zenkit.taskbar.v1', state.taskbarPos)
    } catch {
      /* ignore */
    }
  }
  // Inject/remove a rule that hides ComfyUI's sidebar-bottom button cluster. The rule
  // is harmless if that element isn't present (older ComfyUI) — it just matches nothing.
  function applyComfyBarHide(on: boolean) {
    const id = 'zenkit-hide-comfybar'
    if (on) ensureStyle(id, '.sidebar-item-group.mt-auto{display:none!important}')
    else removeStyle(id)
  }
  function setAbsorbComfyButtons(on: boolean) {
    state.absorbComfyButtons = !!on
    try {
      localStorage.setItem('zenkit.absorbcomfy.v1', on ? '1' : '0')
    } catch {
      /* ignore */
    }
    applyComfyBarHide(state.absorbComfyButtons)
  }
  // install.ts watches this and keeps the startup splash in step with the theme.
  function setThemedSplash(on: boolean) {
    state.themedSplash = !!on
    try {
      localStorage.setItem('zenkit.themedsplash.v1', on ? '1' : '0')
    } catch {
      /* ignore */
    }
  }
  // install.ts watches this and starts/stops the experimental ComfyUI theme-menu injection.
  function setComfyThemeMenu(on: boolean) {
    state.comfyThemeMenu = !!on
    try {
      localStorage.setItem('zenkit.comfythememenu.v1', on ? '1' : '0')
    } catch {
      /* ignore */
    }
  }

  function setSidebarAutohide(on: boolean) {
    state.sidebarAutohide = !!on
    try {
      localStorage.setItem('zenkit.sidebarautohide.v1', on ? '1' : '0')
    } catch {
      /* ignore */
    }
    applySidebarAutohide(state.sidebarAutohide)
  }
  // "Sidebar restyle": pop ComfyUI's opened sidebar content out as a floating card.
  //  • the opened panel (`.sidebar-content-container`) becomes a glassy, rounded, inset
  //    card (the solid bg lives on the `.side-bar-panel`/`.comfyui-body-left` wrapper, so
  //    those go transparent — the canvas shows in the gaps);
  //  • the resize gutter (`.p-splitter-gutter`) blends in (still draggable).
  // The icon rail / toolbar buttons are deliberately left untouched — only the content pops.
  // A frontend that already draws the open panel as its own card (paneled layout,
  // `.separated-panel`) is left alone; restyling it too stacks two outlines.
  function applyFloatingSidebar(on: boolean) {
    const id = 'zenkit-inset-sidebar'
    document.body.classList.toggle('zen-inset-sb', !!on)
    if (on) {
      ensureStyle(
        id,
        `
        /* EVERY sidebar wrapper transparent — ONLY the rounded card below is glassy.
           The solid block is the splitter panel's bg-comfy-menu-bg. NB: ComfyUI only
           adds the .side-bar-panel class on the LEFT — on the RIGHT it's just a bare
           .p-splitterpanel with bg-comfy-menu-bg, so we target it by what it CONTAINS
           (the sidebar content) with :has() to cover both sides. */
        body.zen-inset-sb .side-bar-panel:not(.separated-panel),
        body.zen-inset-sb .p-splitterpanel:not(.separated-panel):has(> .sidebar-content-container),
        body.zen-inset-sb .p-splitterpanel:not(.separated-panel):has(.sidebar-content-container),
        body.zen-inset-sb .comfyui-body-left,
        body.zen-inset-sb .p-splitter { background: transparent !important; box-shadow: none !important; }

        /* the opened panel → a glassy rounded card, inset on all sides by ComfyUI's own
           --spacing unit (pt-1 / 4px) so the gap matches the rest of the UI and the card
           floats free of every edge. height:100% minus top+bottom inset so the bottom
           rounding doesn't overflow. overflow-y-auto kept (clips to the corners). */
        body.zen-inset-sb .p-splitterpanel:not(.separated-panel) .sidebar-content-container {
          height: calc(100% - (var(--spacing, 0.25rem) * 2)) !important;
          margin: var(--spacing, 0.25rem) !important;
          border-radius: var(--zen-radius, 12px);
          border: 1px solid var(--zen-border, #3a3a44);
          background: var(--zen-glass, color-mix(in srgb, var(--zen-bg, #1a1a1f) 78%, transparent)) !important;
          backdrop-filter: blur(12px);
        }

        /* the resize gutter is the divider you drag — keep it full-height and flush with
           the panel edge (no inset/padding) so the grab sits right on the edge, and give it
           a subtle themed line so the divider is visible on dark AND light themes. */
        body.zen-inset-sb .p-splitter-gutter {
          background: color-mix(in srgb, var(--zen-border, #3a3a44) 70%, transparent) !important;
        }
        /* …EXCEPT the gutter touching the restyled sidebar (.side-bar-panel): that side is a
           free-floating glass card, so its resize edge should blend, not show a hard divider.
           ComfyUI puts .side-bar-panel on whichever side the sidebar is docked, so cover both
           — the gutter directly after a left-docked sidebar, or before a right-docked one. */
        body.zen-inset-sb .side-bar-panel + .p-splitter-gutter,
        body.zen-inset-sb .p-splitter-gutter:has(+ .side-bar-panel) {
          background: transparent !important;
        }

        /* …and don't inset the card on its resize side: that spacing opens a gap between the
           card edge and the gutter you grab. Zero just that margin so the card edge meets the
           gutter (grab sits on the card's own edge) — but KEEP the corners rounded so the card
           still reads as a rounded panel. The card keeps floating on its other three sides.
           Mirror for left/right-docked. */
        body.zen-inset-sb .side-bar-panel:not(.separated-panel):has(+ .p-splitter-gutter) .sidebar-content-container {
          margin-right: 0 !important;
        }
        body.zen-inset-sb .p-splitter-gutter + .side-bar-panel:not(.separated-panel) .sidebar-content-container {
          margin-left: 0 !important;
        }

        /* Leave ComfyUI's icon rail / toolbar buttons ALONE — the restyle is only the
           popout card now. (It used to also compact the rail icons, but that fought
           ComfyUI's own sizing and didn't sit right.) */

        /* let the opened panel be dragged narrower than its ~312px (min-w-78) floor */
        body.zen-inset-sb .side-bar-panel { min-width: 180px !important; }

        /* ZenKit's own panels pinned to the sidebar render inside the same
           .sidebar-content-container, so they already get the glass card — blend their
           header bar (normally solid --zen-surface) so the whole thing reads as one
           cohesive floating card. */
        body.zen-inset-sb .p-splitterpanel:not(.separated-panel) .sidebar-content-container .zk-sb-bar {
          background: color-mix(in srgb, var(--zen-surface, #202026) 40%, transparent) !important;
          border-bottom-color: color-mix(in srgb, var(--zen-border, #3a3a44) 60%, transparent) !important;
        }`,
      )
    } else {
      removeStyle(id)
    }
  }
  function setFloatingSidebar(on: boolean) {
    state.floatingSidebar = !!on
    try {
      localStorage.setItem('zenkit.floatingsidebar.v1', on ? '1' : '0')
    } catch {
      /* ignore */
    }
    applyFloatingSidebar(state.floatingSidebar)
  }

  function setHeaderHidden(id: string, hidden: boolean) {
    const p = get(id)
    if (p) {
      p.headerHidden = hidden
      saveGeom()
    }
  }
  function setHeaderPos(id: string, pos: 'top' | 'bottom') {
    const p = get(id)
    if (p) {
      p.headerPos = pos
      saveGeom()
    }
  }
  // Reset to a centered default size/position (and unfold/undock).
  function resetRect(id: string) {
    const p = get(id)
    if (!p) return
    const wasDocked = p.dockSide
    p.dockSide = null
    p.maximized = false
    p.snapped = false
    p.status = 'open'
    if (wasDocked) reconcileDocks()
    Object.assign(p, centeredDefaultRect(p.minWidth, p.minHeight))
    p.floatRect = { x: p.x, y: p.y, w: p.w, h: p.h }
    front(id)
    saveGeom()
  }

  // Move a panel into ComfyUI's native sidebar (a tab manager renders it there).
  function pinSidebar(id: string) {
    const p = get(id)
    if (!p || p.inSidebar) return
    rememberFloat(p)
    p.maximized = false
    p.snapped = false
    if (p.dockSide) {
      p.dockSide = null
      reconcileDocks()
    }
    p.inSidebar = true
    p.status = 'open'
    saveGeom()
    bus.emit('panel:pinned', { id }) // user action (restore doesn't emit) → toast
  }
  function unpinSidebar(id: string) {
    const p = get(id)
    if (!p || !p.inSidebar) return
    p.inSidebar = false
    Object.assign(p, floatGeom(p))
    front(id)
    saveGeom()
  }

  function makeHandle(id: string): PanelHandle {
    return {
      id,
      close: () => close(id),
      minimize: () => minimize(id),
      restore: () => restore(id),
      fold: () => toggleFold(id),
      maximize: () => toggleMaximize(id),
      focus: () => front(id),
      setTitle: (t: string) => setTitle(id, t),
      setIcon: (i: string) => setIcon(id, i),
      dock: (side: DockSide) => setDock(id, side),
      setSize: (size: { w?: number; h?: number; x?: number; y?: number }, persist = true) =>
        setRect(id, size, persist),
      getRect: () => {
        const p = get(id)
        return p ? { x: p.x, y: p.y, w: p.w, h: p.h } : null
      },
      describe: () => exposed.get(id)?.describe?.() ?? null,
      commands: () =>
        Object.entries(exposed.get(id)?.commands ?? {}).map(([name, c]) => ({
          name,
          description: c.description,
        })),
      run: async (command: string, args: Record<string, unknown> = {}) => {
        const api = exposed.get(id)
        if (!api) throw new Error(`Panel "${id}" is not open or exposes no commands.`)
        const handler = api.commands?.[command]
        if (!handler) throw new Error(`Panel "${id}" has no command "${command}".`)
        return handler.run(args)
      },
      on: (event: string, cb: () => void) =>
        bus.on('panel:' + event, (p) => {
          if ((p as { id?: string } | undefined)?.id === id) cb()
        }),
    }
  }

  function register(reg: PanelRegistration) {
    // Re-registering an id replaces it, like taskbar widgets and the plugin ledger; each
    // registration's unregister only removes its own entry.
    const entry = markRaw(reg)
    const existing = state.registry.findIndex((r) => r.id === reg.id)
    if (existing === -1) {
      state.registry.push(entry)
      zlog(`registered "${reg.title}" — ${reg.id}` + (reg.plugin ? ` · ${reg.plugin}` : ''))
    } else {
      state.registry.splice(existing, 1, entry)
    }
    bus.emit('registry:change')

    // re-open panels open last session via the consumer's open(), then replay status
    if (reg.persist !== false) {
      const restoreOne = (id: string, saved: { status?: PanelStatus }) => {
        if (get(id)) return
        zlog(`restoring "${id}" (${saved.status || 'open'})`)
        try {
          // For a singleton the consumer's open() takes no id; an instance gets its id.
          reg.open(id === reg.id ? undefined : id)
          if (saved.status === 'minimized') minimize(id)
          else if (saved.status === 'folded') toggleFold(id)
        } catch (e) {
          console.error('[ZenKit] restore failed for', id, e)
        }
      }
      // Don't let restore-driven opens clobber each zone's saved active/collapsed.
      restoring = true
      try {
        if (reg.multi) {
          // Re-open every saved instance of this type (`${reg.id}#<n>`).
          for (const sid of Object.keys(RESTORE)) {
            if (sid !== reg.id && typeIdOf(sid) === reg.id) restoreOne(sid, RESTORE[sid])
          }
        } else if (RESTORE[reg.id]) {
          restoreOne(reg.id, RESTORE[reg.id])
        }
      } finally {
        restoring = false
        reconcileDocks() // settle any zone whose saved active never materialised
      }
    }
    return () => {
      const i = state.registry.indexOf(entry)
      if (i >= 0) state.registry.splice(i, 1)
      bus.emit('registry:change')
    }
  }

  // open instances of a panel type; drives the ZenBar instance list
  function instancesOf(typeId: string): { id: string; title: string }[] {
    return state.list
      .filter((p) => (p.instanceOf ?? p.id) === typeId)
      .map((p) => ({ id: p.id, title: p.title }))
  }

  // The owning plugin of an open panel (via its registration).
  function pluginOf(panelId: string): string | undefined {
    const typeId = typeIdOf(panelId)
    return state.registry.find((r) => r.id === typeId || r.id === panelId)?.plugin
  }
  const pluginEnabled = (plugin: string) => !state.pluginsDisabled.includes(plugin)
  // ZenKit-level enable/disable: hide a plugin's panels from the launcher/taskbar and
  // close any it has open. Does NOT unload the Python custom_node.
  function setPluginEnabled(plugin: string, on: boolean) {
    const has = state.pluginsDisabled.includes(plugin)
    if (on && has) state.pluginsDisabled = state.pluginsDisabled.filter((p) => p !== plugin)
    else if (!on && !has) state.pluginsDisabled = [...state.pluginsDisabled, plugin]
    else return
    try {
      localStorage.setItem('zenkit.plugins.disabled.v1', JSON.stringify(state.pluginsDisabled))
    } catch {
      /* ignore */
    }
    if (!on) for (const p of state.list.slice()) if (pluginOf(p.id) === plugin) close(p.id)
    bus.emit('registry:change')
  }

  return {
    state,
    open,
    close,
    get: (id: string): PanelHandle | null => (get(id) ? makeHandle(id) : null),
    list: () => state.list.map((p) => p.id),
    instances: (typeId: string) => instancesOf(typeId),
    register,
    registered: () => state.registry.slice(),
    setBranding,
    setBrandingOverride,
    setMinimizedAnchor,
    setTaskbarPos,
    setTaskbarFloating,
    setAbsorbComfyButtons,
    setComfyThemeMenu,
    setThemedSplash,
    setSidebarAutohide,
    setFloatingSidebar,
    setPluginEnabled,
    pluginEnabled,
    // internal ops for the Vue components
    _ops: {
      get,
      front,
      setRect,
      setContentSize,
      applySnap,
      tearOffSize,
      snapshot,
      restoreSnapshot,
      toggleFold,
      toggleMaximize,
      minimize,
      restore,
      close,
      setDock,
      setDockActive,
      toggleDockCollapsed,
      setDockSize,
      reorderDock,
      dropInto,
      toggleDockTab,
      reorderTask,
      sortByTaskOrder,
      dockMembers,
      setInteract,
      setHeaderHidden,
      setHeaderPos,
      resetRect,
      pinSidebar,
      unpinSidebar,
    },
  }
}
