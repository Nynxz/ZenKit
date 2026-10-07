// Workspaces: named surfaces that cover the graph and tile panels in a split tree (the engine in
// ./tiling/engine.ts). At most one is active; none active is the graph itself, so leaving a
// workspace is one toggle away and coming back finds it as it was. A panel belongs to the
// workspace whose tree holds it, so membership is never stored twice.

import { computed, reactive, watch } from 'vue'
import type { AppStore } from './appStore'
import type { PanelStore } from './panelStore'
import { freeArea } from './tiling'
import {
  clampRatio,
  dropTargetAt,
  hasTile,
  insertTile,
  layoutTiles,
  removeTile,
  resolveRect,
  setTileRatio,
  type SplitAxis,
  type TileNode,
  type TilePath,
  type TileTarget,
} from './tiling/engine'
import type { Rect, ZenKitApi } from './types'

export interface Workspace {
  id: string
  name: string
  tree: TileNode | null
}

const LS = 'zenkit.workspaces.v1'

export const ws = reactive({
  list: [] as Workspace[],
  /** The workspace on screen; null = the graph. */
  active: null as string | null,
  /** Where the toggle returns to. */
  last: null as string | null,
  /** Where a dragged panel would tile, while dragging. */
  preview: null as Rect | null,
})

let panels: PanelStore | null = null
let apps: AppStore | null = null

export function attachWorkspaces(store: PanelStore, appStore: AppStore) {
  panels = store
  apps = appStore
  load()
  // Saved a moment after the last change, so a divider drag doesn't write storage every frame.
  let pending = 0
  watch(
    () => [ws.list, ws.last],
    () => {
      clearTimeout(pending)
      pending = window.setTimeout(save, 300)
    },
    { deep: true },
  )
  // "Hide all panels" means "show me the graph": a workspace on screen steps aside for it and
  // comes back when the panels do.
  let hiddenFrom: string | null = null
  watch(
    () => store.state.panelsHidden,
    (hidden) => {
      if (hidden && ws.active) {
        hiddenFrom = ws.active
        leave()
      } else if (!hidden && hiddenFrom) {
        const back = hiddenFrom
        hiddenFrom = null
        if (!ws.active) activate(back)
      }
    },
  )
  // An app and a workspace both cover the graph; opening one leaves the other.
  watch(
    () => appStore.state.active.app,
    (app) => {
      if (app && ws.active) leave()
    },
  )
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(LS) || '{}') as Partial<typeof ws>
    if (Array.isArray(saved.list)) ws.list = saved.list.filter((w) => w && typeof w.id === 'string')
    if (typeof saved.last === 'string') ws.last = saved.last
  } catch {
    /* a fresh start */
  }
  if (!ws.list.length) ws.list = [{ id: 'w1', name: 'Workspace 1', tree: null }]
}
function save() {
  try {
    localStorage.setItem(LS, JSON.stringify({ list: ws.list, last: ws.last }))
  } catch {
    /* storage is a convenience */
  }
}

// --- membership ----------------------------------------------------------------------------------

export function workspaceOf(panelId: string): Workspace | null {
  return ws.list.find((w) => hasTile(w.tree, panelId)) ?? null
}
export const isTiled = (panelId: string) => workspaceOf(panelId) !== null

// --- switching -----------------------------------------------------------------------------------

export function activate(id: string | null) {
  if (id === null) return leave()
  if (!ws.list.some((w) => w.id === id)) return
  if (apps?.state.active.app) apps.close()
  if (panels?.state.panelsHidden) panels.state.panelsHidden = false
  ws.active = id
  ws.last = id
  coverGraph(true)
}
export function leave() {
  ws.active = null
  coverGraph(false)
}

/** While a workspace covers it, the graph (and an animated background) stop drawing: nothing of
 *  them is visible, and redrawing under the tiles is what made resizing them slow. */
function coverGraph(covered: boolean) {
  if (covered) document.documentElement.dataset.zenWorkspace = ''
  else delete document.documentElement.dataset.zenWorkspace
  const canvas = (
    window as {
      app?: { canvas?: { pause_rendering?: boolean; setDirty?: (a: boolean, b: boolean) => void } }
    }
  ).app?.canvas
  if (!canvas) return
  canvas.pause_rendering = covered
  if (!covered) canvas.setDirty?.(true, true)
}
/** Graph ↔ the last workspace. */
export function toggleWorkspace() {
  if (ws.active) leave()
  else activate(ws.last && ws.list.some((w) => w.id === ws.last) ? ws.last : ws.list[0]!.id)
}
export function createWorkspace(name?: string): Workspace {
  let n = ws.list.length + 1
  while (ws.list.some((w) => w.id === `w${n}`)) n++
  const w: Workspace = { id: `w${n}`, name: name ?? `Workspace ${n}`, tree: null }
  ws.list.push(w)
  return w
}
export function renameWorkspace(id: string, name: string) {
  const w = ws.list.find((x) => x.id === id)
  if (w && name.trim()) w.name = name.trim()
}
/** Remove a workspace; its panels float again rather than closing. */
export function removeWorkspace(id: string) {
  if (ws.list.length <= 1) return
  const w = ws.list.find((x) => x.id === id)
  if (!w) return
  ws.list = ws.list.filter((x) => x !== w)
  if (ws.active === id) leave()
  if (ws.last === id) ws.last = ws.list[0]!.id
}

// --- tiling --------------------------------------------------------------------------------------

/** Tile a panel into a workspace (the active one by default, else the last), taking it out of
 *  wherever it was tiled before. Shows that workspace. */
export function tilePanel(panelId: string, target?: TileTarget, workspaceId?: string) {
  const id = workspaceId ?? ws.active ?? ws.last ?? ws.list[0]!.id
  const into = ws.list.find((w) => w.id === id)
  if (!into) return
  untile(panelId)
  into.tree = insertTile(into.tree, panelId, target ?? { kind: 'edge', side: 'right' })
  const p = panels?._ops.get(panelId)
  if (p) {
    if (p.inSidebar) panels!._ops.unpinSidebar(panelId)
    if (p.dockSide) panels!._ops.setDock(panelId, null)
    if (p.status !== 'open') panels!._ops.restore(panelId)
  }
  activate(id)
}
export function untile(panelId: string) {
  for (const w of ws.list) if (hasTile(w.tree, panelId)) w.tree = removeTile(w.tree, panelId)
}
export function setRatio(path: TilePath, ratio: number, workspaceId = ws.active) {
  const w = ws.list.find((x) => x.id === workspaceId)
  if (w) w.tree = setTileRatio(w.tree, path, ratio)
}

// --- layout --------------------------------------------------------------------------------------

/** The area a workspace fills: what the docks, ComfyUI's top bar and the taskbar leave free. */
export function workspaceBounds(): Rect {
  const { x, y, w, h } = freeArea.value
  return { x, y, w, h }
}
export const tileGap = () => freeArea.value.g

const shown = (id: string) => {
  const p = panels?._ops.get(id)
  return !!p && p.status !== 'minimized'
}

export interface Divider {
  path: TilePath
  axis: SplitAxis
  rect: Rect
  /** The split's length along its axis, minus the gutter: ratio per pixel = 1 / length. */
  length: number
  ratio: number
}

/** Pixel rects of the active workspace's tiles and the dividers between them — computed once
 *  and shared, so a divider drag re-lays out the workspace once, not once per panel. */
export const wsLayout = computed(() => {
  const bounds = workspaceBounds()
  const w = ws.list.find((x) => x.id === ws.active)
  const gap = tileGap()
  const layout = layoutTiles(w?.tree ?? null, gap, shown)
  const tiles = new Map<string, Rect>()
  for (const [id, r] of layout.tiles) tiles.set(id, resolveRect(r, bounds))
  const dividers: Divider[] = layout.splits.map((s) => {
    const area = resolveRect(s.area, bounds)
    return {
      path: s.path,
      axis: s.axis,
      ratio: s.ratio,
      rect: resolveRect(s.gutter, bounds),
      length: (s.axis === 'row' ? area.w : area.h) - gap,
    }
  })
  return { bounds, tiles, dividers }
})
export const activeLayout = () => wsLayout.value

/** The rect a tiled panel fills, or 'hidden' when its workspace isn't on screen; null when the
 *  panel isn't tiled. */
export function tileRectOf(panelId: string): Rect | 'hidden' | null {
  const w = workspaceOf(panelId)
  if (!w) return null
  if (w.id !== ws.active) return 'hidden'
  return wsLayout.value.tiles.get(panelId) ?? 'hidden'
}

/** Where a panel dragged to (x, y) would tile in the active workspace. An empty workspace takes
 *  it anywhere; otherwise the edges tile, and Shift splits whichever tile is under the pointer. */
export function dropAt(
  panelId: string,
  x: number,
  y: number,
  anywhere: boolean,
): { target: TileTarget; preview: Rect } | null {
  if (!ws.active) return null
  const { bounds } = wsLayout.value
  const tiles = new Map(wsLayout.value.tiles)
  if (x < bounds.x || x > bounds.x + bounds.w || y < bounds.y || y > bounds.y + bounds.h)
    return null
  tiles.delete(panelId)
  const w = ws.list.find((v) => v.id === ws.active)!
  const tree = w.tree && removeTile(w.tree, panelId)
  const target: TileTarget | null =
    !tree || !tiles.size
      ? { kind: 'edge', side: 'right' }
      : dropTargetAt(x, y, bounds, tiles, { edge: 48, anywhere })
  if (!target) return null
  const next = insertTile(tree, panelId, target)
  const rect = layoutTiles(next, tileGap(), (id) => id === panelId || shown(id)).tiles.get(panelId)
  return rect ? { target, preview: resolveRect(rect, bounds) } : null
}

export const clampTileRatio = (ratio: number, length: number) =>
  clampRatio(ratio, length + tileGap(), tileGap(), 200)

// --- public API ----------------------------------------------------------------------------------

/** `zen.workspaces`: the operations the workspace bar and panel menus use, by id. */
export function workspacesApi(): ZenKitApi['workspaces'] {
  return {
    list: () => ws.list.map((w) => ({ id: w.id, name: w.name })),
    current: () => ws.active,
    create: (name) => createWorkspace(name?.trim() || undefined).id,
    activate,
    rename: renameWorkspace,
    remove: removeWorkspace,
    tile: (panelId) => {
      if (panels?._ops.get(panelId)) tilePanel(panelId)
    },
    onChange: (cb) =>
      watch(
        () => `${ws.active}|${ws.list.map((w) => `${w.id}=${w.name}`).join(',')}`,
        () => cb(ws.active),
      ),
  }
}
