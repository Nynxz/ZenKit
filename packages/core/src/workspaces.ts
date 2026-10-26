// Workspaces: named surfaces that cover the graph and tile panels in a split tree (the engine in
// ./tiling/engine.ts). At most one is active; none active is the graph itself, so leaving a
// workspace is one toggle away and coming back finds it as it was. A panel belongs to the
// workspace whose tree holds it, so membership is never stored twice.
//
// Each workspace belongs to the workflow on screen (stored in its file as `extra.zenkit`) or is
// global (stored in localStorage, shown with every workflow). `ws.list` holds the current
// workflow's workspaces, then the global ones; switching workflow tabs swaps the first group and
// the panels tiled in it (see swapWorkflow).

import { computed, reactive, watch } from 'vue'
import type { AppStore } from './appStore'
import {
  activeWorkflow,
  graphNodeIds,
  isLoadingWorkflow,
  onGraphChanged,
  onWorkflowChange,
  onWorkflowClosed,
  rawOf,
  startWorkflowTracking,
  storedLayout,
  wf,
  workflowName,
  writeActiveExtra,
  type ComfyWorkflowLike,
} from './comfyWorkflows'
import {
  KEPT_ICON,
  panelsHere,
  parseKept,
  rememberKept,
  serializeKept,
  staleTiles,
  type KeptMeta,
} from './keptPanels'
import { zwarn } from './log'
import type { PanelStore } from './panelStore'
import { freeArea } from './tiling'
import {
  clampRatio,
  dropTargetAt,
  hasTile,
  insertTile,
  layoutTiles,
  removeTile,
  renameTile,
  resolveRect,
  setTileRatio,
  type SplitAxis,
  type TileNode,
  type TilePath,
  type TileTarget,
} from './tiling/engine'
import {
  cleanName,
  fitBesideGlobals,
  freshId,
  leafIds,
  parseZenkitExtra,
  planSwap,
  sanitizeTree,
  serializeLayout,
  type StoredWorkspace,
  type WorkflowLayout,
} from './workflowLayout'
import type { Rect, ZenKitApi } from './types'

export type WorkspaceScope = 'workflow' | 'global'

export interface Workspace {
  id: string
  name: string
  tree: TileNode | null
  /** 'workflow': saved in the current workflow's file; 'global': shown with every workflow. */
  scope: WorkspaceScope
}

const LS = 'zenkit.workspaces.v1'
/** Panels closed because their workflow went to the background: not restored on reload, since
 *  only that workflow's layout knows where they go. */
const PARKED_LS = 'zenkit.workspaces.parked.v1'
const PARKED_MAX = 200

export const ws = reactive({
  list: [] as Workspace[],
  /** The workspace on screen; null = the graph. */
  active: null as string | null,
  /** Where the toggle returns to. */
  last: null as string | null,
  /** Where a dragged panel would tile, while dragging. */
  preview: null as Rect | null,
  /** Bumped on every workflow switch, so watchers of the list see the swap. */
  epoch: 0,
})

let panels: PanelStore | null = null
let apps: AppStore | null = null

/** The workflow whose workspaces are in `ws.list` (null until ComfyUI reports one). */
let bound: ComfyWorkflowLike | null = null
/** Its key from last session, for the layout cached in localStorage until ComfyUI is up. */
let bootKey: string | null = null
/** Workflows seen this session, by object: their layout and what was on screen when left. */
const layouts = new WeakMap<object, WorkflowLayout>()
const warned = new WeakSet<object>()
/** Set while a workflow swap rearranges things, so none of it is written back as an edit. */
let swapping = false
/** A workspace to show once a pending workflow switch lands (a jump from the workflow menu). */
let landOn: { key: string; id: string } | null = null
/** Until when the next workflow switch carries the workspace on screen along (see carryView). */
let carryUntil = 0
const parked = new Set<string>()
/** Panels closed with `{ keep: true }` (a followed panel waiting for its workspace, a node's panel
 *  whose workflow went to the background): their tiles still count and are listed. What they show
 *  as while closed. Saved with the workspaces, so counts survive a reload. */
const kept = reactive(new Map<string, KeptMeta>())

/** A tile that holds a full-screen app rather than a panel: `app:<routing key>`. */
const APP_TILE = 'app:'
export const appTileId = (appKey: string) => APP_TILE + appKey
const appKeyOf = (tileId: string) =>
  tileId.startsWith(APP_TILE) ? tileId.slice(APP_TILE.length) : null

const own = () => ws.list.filter((w) => w.scope === 'workflow')
const globals = () => ws.list.filter((w) => w.scope === 'global')
const byId = (id: string | null) => ws.list.find((w) => w.id === id)

export function attachWorkspaces(store: PanelStore, appStore: AppStore) {
  panels = store
  apps = appStore
  // The workspace on screen (or the graph) is the place whose panels show.
  watch(
    () => ws.active,
    (place) => store._ops.enterPlace(place),
    { immediate: true, flush: 'sync' },
  )
  appStore.setTiles({
    has: (key) => isTiled(appTileId(key)),
    reveal: (key) => {
      const home = workspaceOf(appTileId(key))
      if (home) activate(home.id)
    },
  })
  load()
  // Saved a moment after the last change, so a divider drag doesn't write storage every frame.
  let pending = 0
  watch(
    () => [ws.list, ws.last, keptKey()],
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
        show(null)
      } else if (!hidden && hiddenFrom) {
        const back = hiddenFrom
        hiddenFrom = null
        if (!ws.active) show(back)
      }
    },
  )
  // An app and a workspace both cover the graph; opening one leaves the other.
  watch(
    () => appStore.state.active.app,
    (app) => {
      if (app && ws.active) show(null)
      syncCover()
    },
  )
  // The active workspace's app tiles mount when it shows (an app registering late included).
  watch(
    () => [ws.active, ws.epoch, appStore.state.registry.length],
    () => {
      for (const id of leafIds(byId(ws.active)?.tree ?? null)) {
        const key = appKeyOf(id)
        if (key) appStore.runTiled(key)
      }
    },
  )
  // A plugin that registers after its workflow loaded: open its panels that workflow tiles.
  watch(
    () => store.state.registry.length,
    () => reopenTiled(),
  )
  onWorkflowChange(swapWorkflow)
  // A node deleted from the graph leaves its panel's tile behind: prune it once the change settles.
  onGraphChanged(() => scheduleSweep(true))
  // A closed tab's unsaved layout goes with it; reopening the file reads the file.
  onWorkflowClosed((w) => layouts.delete(w))
  startWorkflowTracking()
}

const asWorkspace = (w: StoredWorkspace, scope: WorkspaceScope): Workspace => ({
  id: w.id,
  name: w.name,
  tree: w.tree,
  scope,
})
const stored = (w: Workspace): StoredWorkspace => ({ id: w.id, name: w.name, tree: w.tree })

function load() {
  let list: Workspace[] = []
  try {
    const saved = JSON.parse(localStorage.getItem(LS) || '{}') as {
      list?: unknown[]
      last?: unknown
      session?: { key?: unknown; workspaces?: unknown }
      kept?: unknown
    }
    // Workspaces saved before workflows had their own are this browser's global ones.
    if (Array.isArray(saved.list)) {
      const seen = new Set<string>()
      const budget = { left: Infinity, dropped: 0 }
      for (const w of saved.list as Partial<Workspace>[]) {
        if (!w || typeof w.id !== 'string' || list.some((x) => x.id === w.id)) continue
        list.push({
          id: w.id,
          name: cleanName(w.name) || w.id,
          tree: sanitizeTree(w.tree, seen, budget),
          scope: 'global',
        })
      }
    }
    // The workflow on screen last session, until ComfyUI says which one it restored.
    const s = saved.session
    if (s && typeof s.key === 'string') {
      const { layout } = parseZenkitExtra({ v: 1, workspaces: s.workspaces, active: null })
      if (layout) {
        bootKey = s.key
        const fitted = fitBesideGlobals(layout, list)
        list = [...fitted.workspaces.map((w) => asWorkspace(w, 'workflow')), ...list]
      }
    }
    if (typeof saved.last === 'string' && list.some((w) => w.id === saved.last))
      ws.last = saved.last
    for (const [id, meta] of parseKept(saved.kept)) kept.set(id, meta)
    const p = JSON.parse(localStorage.getItem(PARKED_LS) || '[]')
    if (Array.isArray(p)) for (const id of p) if (typeof id === 'string') parked.add(id)
  } catch {
    /* a fresh start */
  }
  ws.list = list
}
function save() {
  try {
    const key = bound?.path ?? bootKey
    localStorage.setItem(
      LS,
      JSON.stringify({
        list: globals().map(stored),
        last: byId(ws.last)?.scope === 'global' ? ws.last : null,
        ...(key ? { session: { key, workspaces: own().map(stored) } } : {}),
        kept: serializeKept(keptToSave()),
      }),
    )
  } catch {
    /* storage is a convenience */
  }
}
function saveParked() {
  try {
    localStorage.setItem(PARKED_LS, JSON.stringify([...parked].slice(-PARKED_MAX)))
  } catch {
    /* storage is a convenience */
  }
}
// --- kept panels ---------------------------------------------------------------------------------

/** What to save as kept: the kept panels, plus the open panels tiled here that ZenKit doesn't
 *  reopen itself (a node's panel: its node reopens it after a reload, waiting for its workspace),
 *  so their tiles count from the start. */
function keptToSave(): [string, KeptMeta][] {
  const out = new Map(kept)
  for (const w of ws.list)
    for (const id of leafIds(w.tree)) {
      const p = panels?._ops.get(id)
      if (p && !out.has(id) && !canReopen(id)) out.set(id, { title: p.title, icon: p.icon })
    }
  return [...out]
}
const keptKey = () =>
  keptToSave()
    .map(([id, m]) => `${id}|${m.title}|${m.icon}`)
    .join('\n')

/** A panel closed with `{ keep: true }`: its tile (if any) still counts. `meta` is what it showed
 *  as; a closed panel's earlier one is kept. A node's panel also has its graph checked: a node
 *  deletion closes it this way too, and then its tile goes. */
export function keepPanel(id: string, meta: KeptMeta | null) {
  const known = kept.get(id)
  rememberKept(kept, id, meta ?? known ?? { title: id, icon: KEPT_ICON })
  scheduleSweep(true)
}
/** Opened, closed for good or untiled: no longer kept. */
export function unkeep(id: string) {
  kept.delete(id)
}
export const isKept = (id: string) => kept.has(id)

export interface TileEntry {
  id: string
  title: string
  icon: string
  /** Closed and waiting (kept), not open. */
  kept: boolean
}
/** A workspace's panels, in tile order, for its tab's count, tooltip and menu: the open ones (bar
 *  ambient, frameless ones) and the kept ones. */
export function tilesOf(w: Workspace): TileEntry[] {
  const open = (id: string) => {
    if (appKeyOf(id)) return !!apps?.regOf(appKeyOf(id))
    const p = panels?._ops.get(id)
    return !!p && p.frame !== 'none'
  }
  return panelsHere(leafIds(w.tree), open, isKept).map((id) => {
    const app = apps?.regOf(appKeyOf(id))
    if (app)
      return { id, title: app.title, icon: app.icon ?? 'mdi mdi-application-outline', kept: false }
    const p = panels?._ops.get(id)
    if (p) return { id, title: p.title, icon: p.icon, kept: false }
    const m = kept.get(id)!
    return { id, title: m.title, icon: m.icon, kept: true }
  })
}

/** The active workspace's tiles held for kept panels, with their rects: ZenWorkspace draws a quiet
 *  placeholder (title, icon, empty body) in each until the panel opens into it. */
export const waitingTiles = computed(() => {
  const w = byId(ws.active)
  if (!w) return []
  const { tiles } = wsLayout.value
  return tilesOf(w).flatMap((t) => {
    const rect = t.kept ? tiles.get(t.id) : undefined
    return rect ? [{ ...t, rect }] : []
  })
})

/** Show a tiled panel: its workspace, and the panel — reopened by ZenKit when it's a registered
 *  one, by its owner (nodekit following the workspace) when it's a node's. */
export function revealTile(id: string) {
  const home = workspaceOf(id)
  if (!home || !panels) return
  activate(home.id)
  const p = panels._ops.get(id)
  if (p) {
    if (p.status === 'minimized') panels._ops.restore(id)
    else panels._ops.front(id)
  } else if (canReopen(id)) {
    unpark(id)
    try {
      panels.open(id)
    } catch (e) {
      console.error('[ZenKit] could not reopen', id, e)
    }
  }
}

// Deleted nodes. A node's panel is closed with `keep` both when its workflow goes to the background
// and when the node is deleted (the packs do it from `node.onRemoved`, which can't tell them apart).
// Once things settle, a closed node-bound tile whose graph is on screen but whose node isn't there
// was deleted: its tile goes, with its kept entry and remembered place. A workflow switch is safe:
// the outgoing graph is cleared under a fresh id, so its panels' graph isn't found and nothing is
// pruned; an undo reloads the same graph with the node back in it.
let sweepTimer = 0
let sweepCommit = false
/** False until the first sweep after a workflow lands: tiles that workflow brought in stale are
 *  pruned in memory, without marking a just-opened workflow modified. */
let sweptSinceSwap = true
function scheduleSweep(commit: boolean) {
  sweepCommit ||= commit
  clearTimeout(sweepTimer)
  sweepTimer = window.setTimeout(sweep, 300)
}
function sweep() {
  if (!panels) return
  if (isLoadingWorkflow() || swapping) return scheduleSweep(false)
  const commit = sweepCommit && sweptSinceSwap
  sweepCommit = false
  sweptSinceSwap = true
  const ids = ws.list.flatMap((w) => leafIds(w.tree))
  const stale = staleTiles(ids, (id) => !!panels?._ops.get(id), graphNodeIds)
  if (!stale.length) return
  for (const id of stale) {
    removeEverywhere(id)
    kept.delete(id)
    unpark(id)
    panels._ops.forget(id)
  }
  if (commit) commitLayout()
}

/** Panels a background workflow's layout holds: they wait for it rather than restoring. */
export const isParked = (panelId: string) => parked.has(panelId)
export function unpark(panelId: string) {
  if (parked.delete(panelId)) saveParked()
}

/** Write the current workflow's workspaces into its file (and remember them for this session).
 *  Called on discrete changes and at the end of a divider drag, never per frame. */
export function commitLayout() {
  if (swapping || !bound) return
  const mine = own()
  layouts.set(bound, { workspaces: mine.map(stored), active: ws.active })
  const active = mine.some((w) => w.id === ws.active) ? ws.active : null
  writeActiveExtra(serializeLayout({ workspaces: mine, active }))
}

// --- workflow switching --------------------------------------------------------------------------

/** Which panels a workflow layout may open: registered ones only (a singleton by its id, an
 *  instance of a multi panel), from enabled plugins. A node's own panel (its id names the graph and
 *  node) is opened by that node when the workflow loads, so the layout only keeps its tile. */
function canReopen(id: string): boolean {
  if (!panels) return false
  const hash = id.indexOf('#')
  const reg = panels.state.registry.find(
    (r) => r.id === id || (hash > 0 && (r.multi || r.copies) && r.id === id.slice(0, hash)),
  )
  return !!reg && !reg.spawnOnly && (!reg.plugin || panels.pluginEnabled(reg.plugin))
}

/** The active workflow tab changed: put away the outgoing workflow's workspaces and the panels
 *  only they hold, bring in the incoming one's, and land where it was left. Instant. */
function swapWorkflow(prev: ComfyWorkflowLike | null, next: ComfyWorkflowLike) {
  const outgoing = own()
  if (prev) layouts.set(prev, { workspaces: outgoing.map(stored), active: ws.active })
  let incoming = layouts.get(next)
  if (!incoming) {
    const { layout, problem } = parseZenkitExtra(storedLayout(next))
    if (problem && !warned.has(next)) {
      warned.add(next)
      zwarn(`"${workflowName(next)}": ignored part of its saved workspaces (${problem})`)
    }
    // Last session's cache stands in for a workflow whose file has no layout yet (unsaved).
    incoming =
      layout ??
      (!prev && bootKey === next.path
        ? { workspaces: outgoing.map(stored), active: null }
        : { workspaces: [], active: null })
  }
  // Opened by a tool (an agent's call), not a tab click: the workspace on screen comes along, so
  // whoever asked keeps their chat and panels while the new workflow loads under them.
  const carried = prev && Date.now() < carryUntil ? byId(ws.active) : undefined
  carryUntil = 0
  if (carried?.scope === 'workflow' && !incoming.workspaces.some((w) => w.id === carried.id))
    incoming = { workspaces: [...incoming.workspaces, stored(carried)], active: carried.id }
  bootKey = null
  sweptSinceSwap = false
  scheduleSweep(false)
  const keep = globals()
  const fitted = fitBesideGlobals(incoming, keep)
  const plan = planSwap({
    outgoing: outgoing.map((w) => w.tree),
    incoming: fitted.workspaces.map((w) => w.tree),
    globals: keep.map((w) => w.tree),
    isOpen: (id) => !!panels?._ops.get(id),
    canReopen,
  })
  const wasOn = byId(ws.active)
  const target = landOn?.key === next.path ? landOn.id : fitted.active
  landOn = null
  swapping = true
  try {
    for (const id of plan.close) {
      parked.add(id)
      panels?.close(id, { keep: true })
    }
    bound = next
    ws.list = [...fitted.workspaces.map((w) => asWorkspace(w, 'workflow')), ...keep]
    ws.epoch++
    for (const id of plan.open) {
      unpark(id)
      try {
        panels?.open(id)
      } catch (e) {
        console.error('[ZenKit] could not reopen', id, e)
      }
    }
    if (plan.close.length) saveParked()
    // Land: the workspace this workflow had on screen; else stay on a global one; else the graph.
    // The first workflow after a reload starts on the graph, as ZenKit always has.
    const land = byId(target) ?? (wasOn?.scope === 'global' ? wasOn : undefined)
    if (!prev) {
      if (ws.active && !byId(ws.active)) show(null)
    } else if (apps?.state.active.app) {
      if (ws.active) show(null)
    } else show(land?.id ?? null)
    if (land) ws.last = land.id
    else if (!byId(ws.last)) ws.last = ws.list[0]?.id ?? null
  } finally {
    swapping = false
  }
}

function reopenTiled() {
  if (!bound || swapping) return
  for (const w of own())
    for (const id of leafIds(w.tree))
      if (!panels?._ops.get(id) && canReopen(id)) {
        unpark(id)
        panels?.open(id)
      }
}

/** The workflow about to be opened programmatically keeps the workspace on screen: it comes along
 *  to that workflow instead of going to the background with the one left. */
export function carryView() {
  carryUntil = Date.now() + 5000
}

/** Switch to a workflow tab and show one of its workspaces once it lands. */
export function landOnAfterSwitch(key: string, workspaceId: string) {
  landOn = { key, id: workspaceId }
}
export const currentWorkflowName = () => wf.open.find((e) => e.active)?.name ?? null
/** A workflow's workspaces for the workflow menu: the current one's live list, another open
 *  tab's remembered or saved layout. */
export function workspacesOfWorkflow(w: ComfyWorkflowLike): { id: string; name: string }[] {
  if (rawOf(w) === bound) return own().map((x) => ({ id: x.id, name: x.name }))
  const known = layouts.get(rawOf(w)) ?? parseZenkitExtra(storedLayout(w)).layout
  return known?.workspaces.map((x) => ({ id: x.id, name: x.name })) ?? []
}
export const hasWorkflow = () => !!(bound ?? activeWorkflow())

// --- membership ----------------------------------------------------------------------------------

export function workspaceOf(panelId: string): Workspace | null {
  return ws.list.find((w) => hasTile(w.tree, panelId)) ?? null
}
export const isTiled = (panelId: string) => workspaceOf(panelId) !== null

// --- stepping out of a tile -----------------------------------------------------------------------
// A panel exists once, so a tiled one opened somewhere else (the graph, another workspace) steps
// out of its tile and floats there, an ordinary floating panel from then on. Its tile stays,
// renamed to a placeholder that offers to bring it back; nothing moves it back by itself.

const AWAY = 'zen-away@'
const awayId = (panelId: string) => AWAY + panelId
const awayPanelOf = (tileId: string) => (tileId.startsWith(AWAY) ? tileId.slice(AWAY.length) : null)

/** Take a tiled panel out of its tile, leaving a placeholder there. */
export function stepOut(panelId: string) {
  let changed = false
  for (const w of ws.list)
    if (hasTile(w.tree, panelId)) {
      w.tree = renameTile(w.tree, panelId, awayId(panelId))
      changed = true
    }
  if (changed) commitLayout()
}
/** The workspace holding a placeholder for `panelId`, if it stepped out of one. */
export const placeholderHome = (panelId: string): Workspace | null =>
  ws.list.find((w) => hasTile(w.tree, awayId(panelId))) ?? null
/** Put a panel back in the tile it stepped out of (reopening it if it was closed) and show it. */
export function bringBack(panelId: string) {
  const home = placeholderHome(panelId)
  if (!home) return
  for (const w of ws.list) if (w !== home) w.tree = removeTile(w.tree, awayId(panelId))
  home.tree = renameTile(home.tree, awayId(panelId), panelId)
  panels?._ops.setPlace(panelId, home.id)
  revealTile(panelId)
}
/** Remove the placeholder a panel left, closing up its tile. */
export function dropPlaceholder(panelId: string) {
  if (removeEverywhere(awayId(panelId))) commitLayout()
}

export interface AwayTile {
  /** The panel that stepped out. */
  id: string
  title: string
  icon: string
  /** Still open (floating or minimized), rather than closed. */
  open: boolean
  rect: Rect
}
/** The active workspace's placeholders, with their rects, for ZenWorkspace to draw. */
export const awayTiles = computed<AwayTile[]>(() => {
  const w = byId(ws.active)
  if (!w) return []
  const { tiles } = wsLayout.value
  return leafIds(w.tree).flatMap((tileId) => {
    const id = awayPanelOf(tileId)
    const rect = tiles.get(tileId)
    if (!id || !rect) return []
    const p = panels?._ops.get(id)
    const reg = panels?.state.registry.find((r) => r.id === id || id.startsWith(r.id + '#'))
    const meta = kept.get(id)
    return [
      {
        id,
        title: p?.title ?? reg?.title ?? meta?.title ?? id,
        icon: p?.icon ?? reg?.icon ?? meta?.icon ?? KEPT_ICON,
        open: !!p,
        rect,
      },
    ]
  })
})

// --- switching -----------------------------------------------------------------------------------

/** Show a workspace (or the graph with null) as the user's choice: remembered in the workflow. */
export function activate(id: string | null) {
  if (id !== null && !byId(id)) return
  show(id)
  commitLayout()
}
export function leave() {
  activate(null)
}
/** Show without recording it: workflow swaps, "hide panels" and apps step in and out this way. */
function show(id: string | null) {
  if (id === null) {
    ws.active = null
    syncCover()
    return
  }
  if (!byId(id)) return
  if (apps?.state.active.app) apps.minimize()
  if (panels?.state.panelsHidden) panels.state.panelsHidden = false
  ws.active = id
  ws.last = id
  syncCover()
}

/** A full-screen app is showing: the graph, its docks and ComfyUI's sidebar are under it, so a
 *  panel dragged to an edge must not dock there, out of sight. */
export function appCoversGraph(): boolean {
  return !!apps?.state.active.app
}

/** While a workspace or an app covers it, the graph (and an animated background) stop drawing:
 *  nothing of them is visible, and redrawing under the tiles is what made resizing them slow. */
function syncCover() {
  const covered = !!ws.active || appCoversGraph()
  if (covered) document.documentElement.dataset.zenCovered = ''
  else delete document.documentElement.dataset.zenCovered
  const canvas = (
    window as {
      app?: { canvas?: { pause_rendering?: boolean; setDirty?: (a: boolean, b: boolean) => void } }
    }
  ).app?.canvas
  if (!canvas) return
  canvas.pause_rendering = covered
  if (!covered) canvas.setDirty?.(true, true)
}
/** Graph ↔ the last workspace (a new one for this workflow when there are none). */
export function toggleWorkspace() {
  if (ws.active) return leave()
  const to = byId(ws.last) ?? ws.list[0] ?? createWorkspace()
  activate(to.id)
}
/** Add a workspace — the current workflow's by default (global when there's no workflow). */
export function createWorkspace(name?: string, scope?: WorkspaceScope): Workspace {
  const where: WorkspaceScope = scope ?? (hasWorkflow() ? 'workflow' : 'global')
  const taken = new Set(ws.list.map((w) => w.id))
  const id = freshId(taken, where === 'global' ? 'g' : 'w')
  const n = (where === 'global' ? globals() : own()).length + 1
  const w: Workspace = {
    id,
    name: cleanName(name) || (where === 'global' ? `Global ${n}` : `Workspace ${n}`),
    tree: null,
    scope: where,
  }
  ws.list = where === 'global' ? [...ws.list, w] : [...own(), w, ...globals()]
  commitLayout()
  return byId(id)!
}
export function renameWorkspace(id: string, name: string) {
  const w = byId(id)
  const clean = cleanName(name)
  if (w && clean && clean !== w.name) {
    w.name = clean
    commitLayout()
  }
}
/** Remove a workspace; its panels float again rather than closing. */
export function removeWorkspace(id: string) {
  const w = byId(id)
  if (!w) return
  ws.list = ws.list.filter((x) => x !== w)
  for (const p of leafIds(w.tree)) unkeep(p)
  panels?._ops.movePlace(id, null)
  if (ws.active === id) show(null)
  if (ws.last === id) ws.last = ws.list[0]?.id ?? null
  commitLayout()
}
/** Pin a workspace as global (shown with every workflow), or make it the current workflow's. */
export function pinWorkspace(id: string, global: boolean) {
  const w = byId(id)
  const scope: WorkspaceScope = global ? 'global' : 'workflow'
  if (!w || w.scope === scope || (!global && !hasWorkflow())) return
  w.scope = scope
  ws.list = [...own(), ...globals()]
  commitLayout()
}

// --- tiling --------------------------------------------------------------------------------------

/** Tile a panel into a workspace (the active one by default, else the last), taking it out of
 *  wherever it was tiled before. Shows that workspace. */
export function tilePanel(panelId: string, target?: TileTarget, workspaceId?: string) {
  const id = workspaceId ?? (byId(ws.active) ?? byId(ws.last) ?? ws.list[0] ?? createWorkspace()).id
  const into = byId(id)
  if (!into) return
  removeEverywhere(panelId)
  removeEverywhere(awayId(panelId))
  into.tree = insertTile(into.tree, panelId, target ?? { kind: 'edge', side: 'right' })
  const p = panels?._ops.get(panelId)
  if (p) {
    panels!._ops.setPlace(panelId, id)
    if (p.inSidebar) panels!._ops.unpinSidebar(panelId)
    if (p.dockSide) panels!._ops.setDock(panelId, null)
    if (p.status !== 'open') panels!._ops.restore(panelId)
  }
  unpark(panelId)
  activate(id)
}
function removeEverywhere(panelId: string): boolean {
  let changed = false
  for (const w of ws.list)
    if (hasTile(w.tree, panelId)) {
      w.tree = removeTile(w.tree, panelId)
      changed = true
    }
  return changed
}
export function untile(panelId: string) {
  unkeep(panelId)
  if (removeEverywhere(panelId)) commitLayout()
}

/** Tile a full-screen app into a workspace (the active one, else the last, else a new one): it
 *  keeps running there beside the panels, and its workspace shows. */
export function tileApp(appKey: string, workspaceId?: string) {
  if (!apps?.regOf(appKey)) return
  apps.runTiled(appKey)
  if (apps.state.active.app === appKey) apps.minimize()
  tilePanel(appTileId(appKey), undefined, workspaceId)
}
/** Take an app out of its workspace and show it full screen again. */
export function untileApp(appKey: string) {
  untile(appTileId(appKey))
  apps?.restore(appKey)
}
/** Set a split's ratio. Not written to the workflow: call commitLayout when the drag ends. */
export function setRatio(path: TilePath, ratio: number, workspaceId = ws.active) {
  const w = byId(workspaceId)
  if (w) w.tree = setTileRatio(w.tree, path, ratio)
}

// --- layout --------------------------------------------------------------------------------------

/** The area a workspace fills: what the docks, ComfyUI's top bar and the taskbar leave free. */
export function workspaceBounds(): Rect {
  const { x, y, w, h } = freeArea.value
  return { x, y, w, h }
}
export const tileGap = () => freeArea.value.g

/** Whether a tile takes space: its panel is open (not minimized), or kept — closed while it waits
 *  to reopen there, so its rect is held for it and the other tiles don't reflow when it does. */
const shown = (id: string) => {
  if (awayPanelOf(id)) return true
  const appKey = appKeyOf(id)
  if (appKey) return !!apps?.regOf(appKey)
  const p = panels?._ops.get(id)
  return p ? p.status !== 'minimized' : kept.has(id)
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
    list: () => ws.list.map((w) => ({ id: w.id, name: w.name, scope: w.scope })),
    current: () => ws.active,
    create: (name, opts) => createWorkspace(name?.trim() || undefined, opts?.scope).id,
    activate,
    rename: renameWorkspace,
    remove: removeWorkspace,
    pin: pinWorkspace,
    tile: (panelId) => {
      if (panels?._ops.get(panelId)) tilePanel(panelId)
    },
    of: (panelId) => workspaceOf(panelId)?.id ?? null,
    // Keyed on which panels each workspace tiles (not its ratios), so tiling and untiling
    // notify but a divider drag doesn't.
    onChange: (cb) =>
      watch(
        () =>
          `${ws.epoch}|${ws.active}|${ws.list.map((w) => `${w.id}=${w.scope}:${w.name}[${leafIds(w.tree).join(' ')}]`).join(',')}`,
        () => cb(ws.active),
      ),
  }
}
